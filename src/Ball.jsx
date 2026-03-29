import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { getBet365All, getLeagueGroup, getAssociation, createOrder, createContactOrder, getOrderList, getOrderFlow, getUserBalance } from "./api";
import { useOddsSocket } from "./useOddsSocket";

function getMatchListFromOddsResponse(raw, matchType) {
    // 尽量兼容不同返回结构
    if (!raw) return [];

    const data = raw?.data?.data ?? raw?.data ?? raw;

    // bet365/all 格式: data.inPlay / data.preMatch = [ { key, value: [matches] } ]
    // matchType: "0" 或 0 = 早盘(preMatch)，"1" 或 1 = 滚球(inPlay)
    const isRolling = matchType === 1 || matchType === "1";
    const list = isRolling ? data?.inPlay : data?.preMatch;
    if (Array.isArray(list)) {
        return list.flatMap((item) => item?.value ?? []);
    }

    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.list)) return data.list;
    if (Array.isArray(data?.matchList)) return data.matchList;
    if (Array.isArray(data?.events)) return data.events;

    return [];
}

/** 将 WS 推送的 MAVO 的字段名归一为与 API 一致（如 ID->id, NA->na, OD->od），避免 WS 用 Fastjson 大写/驼峰导致前端匹配/展示异常 */
function normalizeMavoFromWs(mavo) {
    if (!mavo || typeof mavo !== "object") return mavo;
    const MAVO_KEYS = { ID: "id", NA: "na", iD: "id", nA: "na", CN: "cn", DO: "do", FI: "fi", IT: "it", SU: "su", SS: "ss", TM: "tm", TS: "ts", TU: "tu", TT: "tt", CP: "cp" };
    const COVO_KEYS = { CN: "cn", NA: "na", cN: "cn", nA: "na" };
    const PAVO_KEYS = { ID: "id", iD: "id", NA: "na", nA: "na", OD: "od", oD: "od", HA: "ha", hA: "ha", FI: "fi", fI: "fi", IT: "it", iT: "it", N2: "n2", n2: "n2", SU: "su", sU: "su", HD: "hd", hD: "hd", BS: "bs", bS: "bs", pNa: "pNa" };

    function addLowerAliases(obj, keyMap) {
        if (!obj || typeof obj !== "object") return;
        Object.keys(keyMap).forEach((upper) => {
            if (obj[upper] !== undefined && obj[keyMap[upper]] === undefined) {
                obj[keyMap[upper]] = obj[upper];
            }
        });
    }

    function normalizePa(pa) {
        if (!pa || typeof pa !== "object") return;
        addLowerAliases(pa, PAVO_KEYS);
    }

    function normalizeCo(co) {
        if (!co || typeof co !== "object") return;
        addLowerAliases(co, COVO_KEYS);
        if (Array.isArray(co.pa)) co.pa.forEach(normalizePa);
    }

    addLowerAliases(mavo, MAVO_KEYS);
    if (Array.isArray(mavo.co)) mavo.co.forEach(normalizeCo);
    return mavo;
}

/** 从合并前的数据里找出本场、本玩法中「赔率发生变化」的选项 id 列表（用于只高亮变化的赔率）。
 * 包含：新推送里赔率与旧不同的选项、旧有但新推送里没有的选项、以及旧有但新推送里变为空的选项。
 */
function getChangedPaIds(prevRaw, normalizedMavo) {
    if (!prevRaw || !normalizedMavo) return [];
    const eventId = normalizedMavo.eventId != null ? String(normalizedMavo.eventId) : null;
    const maId = normalizedMavo.id != null ? String(normalizedMavo.id) : null;
    if (eventId == null || maId == null) return [];

    const data = prevRaw?.data?.data ?? prevRaw?.data ?? prevRaw;
    const inPlay = data?.inPlay;
    if (!Array.isArray(inPlay)) return [];

    let oldMavo = null;
    for (const group of inPlay) {
        const value = group?.value;
        if (!Array.isArray(value)) continue;
        for (const match of value) {
            const mid = match?.id != null ? String(match.id) : match?.bet365Id != null ? String(match.bet365Id) : null;
            if (mid !== eventId) continue;
            const tree = match?.treeResults;
            if (!Array.isArray(tree)) break;
            oldMavo = tree.find((m) => (m?.id != null ? String(m.id) : m?.ID != null ? String(m.ID) : null) === maId);
            break;
        }
        if (oldMavo) break;
    }
    if (!oldMavo) return [];

    const oldOptions = oldMavo?.co?.flatMap((c) => c.pa || []) ?? [];
    const oldOdds = new Map();
    oldOptions.forEach((pa) => {
        const id = pa?.id != null ? String(pa.id) : pa?.ID != null ? String(pa.ID) : null;
        if (id != null) oldOdds.set(id, pa?.od ?? pa?.OD ?? "");
    });

    const newOptions = normalizedMavo?.co?.flatMap((c) => c.pa || []) ?? [];
    const newOdds = new Map();
    newOptions.forEach((pa) => {
        const id = pa?.id != null ? String(pa.id) : pa?.ID != null ? String(pa.ID) : null;
        if (id != null) newOdds.set(id, pa?.od ?? pa?.OD ?? "");
    });

    const changedPaIds = [];
    oldOdds.forEach((oldOd, id) => {
        const newOd = newOdds.get(id);
        const oldStr = String(oldOd ?? "").trim();
        const newStr = String(newOd ?? "").trim();
        if (newOd === undefined || newStr === "" || oldStr !== newStr) {
            changedPaIds.push(id);
        }
    });
    newOdds.forEach((newOd, id) => {
        const oldOd = oldOdds.get(id);
        const oldStr = String(oldOd ?? "").trim();
        const newStr = String(newOd ?? "").trim();
        if (oldOd === undefined || oldStr !== newStr) {
            if (!changedPaIds.includes(id)) changedPaIds.push(id);
        }
    });
    return changedPaIds;
}

/** 将 WS 推送的 MAVO 合并进 matchRaw：按 eventId 找到比赛，按玩法 id 找到 mavo，只合并 co[].pa 的赔率等字段，不整条替换，避免推送只含部分选项时丢失其余选项导致无法下单 */
function mergeMavoIntoMatchRaw(prevRaw, mavo) {
    if (!prevRaw || !mavo) return prevRaw;
    const eventId = mavo.eventId != null ? String(mavo.eventId) : null;
    if (eventId == null) return prevRaw;

    const data = prevRaw?.data?.data ?? prevRaw?.data ?? prevRaw;
    const inPlay = data?.inPlay;
    if (!Array.isArray(inPlay)) return prevRaw;

    const newInPlay = inPlay.map((group) => {
        const value = group?.value;
        if (!Array.isArray(value)) return group;
        const newValue = value.map((match) => {
            const mid = match?.id != null ? String(match.id) : match?.bet365Id != null ? String(match.bet365Id) : null;
            if (mid !== eventId) return match;
            const tree = Array.isArray(match.treeResults) ? match.treeResults.slice() : [];
            const maIdStr = mavo.id != null ? String(mavo.id) : mavo.ID != null ? String(mavo.ID) : null;
            const idx = maIdStr == null ? -1 : tree.findIndex((m) => (m?.id != null ? String(m.id) : m?.ID != null ? String(m.ID) : null) === maIdStr);
            if (idx >= 0) {
                tree[idx] = mergeMavoPaIntoExisting(tree[idx], mavo);
            } else {
                tree.push(mavo);
            }
            let updatedMatch = { ...match, treeResults: tree };
            const pushScore = mavo.sS ?? mavo.SS;
            if (pushScore != null) updatedMatch.ballScore = String(pushScore);

            const pushMin = mavo.tM ?? mavo.TM;
            const pushSec = mavo.tS ?? mavo.TS;
            const payloadHalf = parseHalfFromPayload(mavo);
            const isBreak = isTtBreak(mavo);
            if (pushMin != null || pushSec != null) {
                const min = pushMin != null ? Number(pushMin) : (updatedMatch.liveClockMinute ?? 0);
                const sec = pushSec != null ? Number(pushSec) : (updatedMatch.liveClockSecond ?? 0);
                updatedMatch = {
                    ...updatedMatch,
                    liveClockMinute: min,
                    liveClockSecond: sec,
                    liveClockUpdatedAt: Date.now(),
                    liveHalf: payloadHalf != null ? payloadHalf : (min <= 45 ? 1 : 2),
                    liveClockIsPeriodTime: true,
                    liveClockOnBreak: isBreak,
                };
            } else {
                const tuMs = parseTUToUtcMs(mavo.tU ?? mavo.TU);
                const kickoffMs = getKickoffMs(match);
                if (tuMs != null && kickoffMs != null) {
                    const elapsedSec = Math.max(0, Math.floor((tuMs - kickoffMs) / 1000));
                    const totalMin = Math.floor(elapsedSec / 60);
                    const sec = Math.floor(elapsedSec % 60);
                    const inferredHalf = totalMin < 45 ? 1 : 2;
                    updatedMatch = {
                        ...updatedMatch,
                        liveClockMinute: totalMin,
                        liveClockSecond: sec,
                        liveClockUpdatedAt: Date.now(),
                        liveHalf: payloadHalf != null ? payloadHalf : inferredHalf,
                        liveClockIsPeriodTime: false,
                        liveClockOnBreak: isBreak,
                    };
                }
            }
            return updatedMatch;
        });
        return { ...group, value: newValue };
    });

    const newData = { ...data, inPlay: newInPlay };
    if (prevRaw.data?.data) {
        return { ...prevRaw, data: { ...prevRaw.data, data: newData } };
    }
    if (prevRaw.data) {
        return { ...prevRaw, data: { ...prevRaw.data, ...newData } };
    }
    return { ...prevRaw, ...newData };
}

/** 将推送的 mavo 的 co[].pa 赔率合并进已有 mavo，保留已有选项结构，只更新匹配到的 pa 的 od/ha/na 等；若推送里没有对应 co/pa 则保留原值 */
function mergeMavoPaIntoExisting(existingMavo, pushMavo) {
    if (!existingMavo || !pushMavo) return existingMavo;
    const existingCo = Array.isArray(existingMavo.co) ? existingMavo.co : [];
    const pushCo = Array.isArray(pushMavo.co) ? pushMavo.co : [];
    if (pushCo.length === 0) return existingMavo;

    const newCo = existingCo.map((existingC, coIndex) => {
        const existingPa = Array.isArray(existingC.pa) ? existingC.pa : [];
        const pushC = pushCo[coIndex] || pushCo[0];
        const pushPaList = Array.isArray(pushC.pa) ? pushC.pa : [];
        const paById = new Map();
        pushPaList.forEach((p) => {
            const pid = p?.id ?? p?.ID;
            if (pid != null) paById.set(String(pid), p);
        });
        const newPa = existingPa.map((oldPa) => {
            const paId = oldPa?.id ?? oldPa?.ID;
            const pushed = paId != null ? paById.get(String(paId)) : null;
            if (!pushed) return oldPa;
            return { ...oldPa, od: pushed.od ?? pushed.OD ?? oldPa.od ?? oldPa.OD, OD: pushed.OD ?? pushed.od ?? oldPa.OD ?? oldPa.od, ha: pushed.ha ?? pushed.HA ?? oldPa.ha ?? oldPa.HA, HA: pushed.HA ?? pushed.ha ?? oldPa.HA ?? oldPa.ha, na: pushed.na ?? pushed.NA ?? oldPa.na ?? oldPa.NA, NA: pushed.NA ?? pushed.na ?? oldPa.NA ?? oldPa.na };
        });
        const addedPaIds = new Set(existingPa.map((p) => String(p?.id ?? p?.ID ?? "")));
        pushPaList.forEach((p) => {
            const pid = p?.id ?? p?.ID;
            if (pid != null && !addedPaIds.has(String(pid))) {
                newPa.push(p);
                addedPaIds.add(String(pid));
            }
        });
        return { ...existingC, pa: newPa };
    });

    return {
        ...existingMavo,
        ...pushMavo,
        id: pushMavo.id ?? pushMavo.ID ?? existingMavo.id ?? existingMavo.ID,
        ID: pushMavo.ID ?? pushMavo.id ?? existingMavo.ID ?? existingMavo.id,
        na: pushMavo.na ?? pushMavo.NA ?? existingMavo.na ?? existingMavo.NA,
        NA: pushMavo.NA ?? pushMavo.na ?? existingMavo.NA ?? existingMavo.na,
        updateAt: pushMavo.updateAt ?? pushMavo.UpdateAt ?? existingMavo.updateAt ?? existingMavo.UpdateAt,
        UpdateAt: pushMavo.UpdateAt ?? pushMavo.updateAt ?? existingMavo.UpdateAt ?? existingMavo.updateAt,
        co: newCo.length > 0 ? newCo : (pushMavo.co || existingMavo.co),
    };
}

function toComparableUpdateAt(mavo) {
    const raw = mavo?.updateAt ?? mavo?.UpdateAt;
    if (raw == null || raw === "") return -1;
    const n = Number(raw);
    return Number.isFinite(n) ? n : -1;
}

function mergeTreeResultsPreferNewer(existingTree, incomingTree) {
    const existing = Array.isArray(existingTree) ? existingTree : [];
    const incoming = Array.isArray(incomingTree) ? incomingTree : [];
    if (existing.length === 0) return incoming;
    if (incoming.length === 0) return existing;

    const incomingById = new Map();
    incoming.forEach((mavo) => {
        const id = mavo?.id ?? mavo?.ID;
        if (id != null) incomingById.set(String(id), mavo);
    });

    const merged = existing.map((oldMavo) => {
        const id = oldMavo?.id ?? oldMavo?.ID;
        if (id == null) return oldMavo;
        const nextMavo = incomingById.get(String(id));
        if (!nextMavo) return oldMavo;
        incomingById.delete(String(id));
        return toComparableUpdateAt(nextMavo) >= toComparableUpdateAt(oldMavo) ? nextMavo : oldMavo;
    });

    incomingById.forEach((mavo) => merged.push(mavo));
    return merged;
}

function mergeMatchRawPreferNewer(prevRaw, nextRaw) {
    if (!prevRaw) return nextRaw;
    if (!nextRaw) return prevRaw;

    const prevData = prevRaw?.data?.data ?? prevRaw?.data ?? prevRaw;
    const nextData = nextRaw?.data?.data ?? nextRaw?.data ?? nextRaw;
    const prevInPlay = Array.isArray(prevData?.inPlay) ? prevData.inPlay : null;
    const nextInPlay = Array.isArray(nextData?.inPlay) ? nextData.inPlay : null;
    if (!prevInPlay || !nextInPlay) return nextRaw;

    const prevByMatchId = new Map();
    prevInPlay.forEach((group) => {
        (group?.value ?? []).forEach((match) => {
            const id = match?.id ?? match?.bet365Id;
            if (id != null) prevByMatchId.set(String(id), match);
        });
    });

    const mergedInPlay = nextInPlay.map((group) => {
        const value = Array.isArray(group?.value) ? group.value : [];
        const mergedValue = value.map((match) => {
            const id = match?.id ?? match?.bet365Id;
            if (id == null) return match;
            const prevMatch = prevByMatchId.get(String(id));
            if (!prevMatch) return match;
            return {
                ...match,
                treeResults: mergeTreeResultsPreferNewer(prevMatch?.treeResults, match?.treeResults),
            };
        });
        return { ...group, value: mergedValue };
    });

    const mergedData = { ...nextData, inPlay: mergedInPlay };
    if (nextRaw.data?.data) {
        return { ...nextRaw, data: { ...nextRaw.data, data: mergedData } };
    }
    if (nextRaw.data) {
        return { ...nextRaw, data: { ...nextRaw.data, ...mergedData } };
    }
    return { ...nextRaw, ...mergedData };
}

function getMatchKey(match, index) {
    return (
        match?.id ||
        match?.bet365Id ||
        match?.eventId ||
        match?.matchId ||
        `${match?.homeNameCN || match?.homeTeamName || "home"}_${match?.awayNameCN || match?.awayTeamName || "away"}_${index}`
    );
}

function getHomeName(match) {
    return (
        match?.oHomeName ||
        match?.homeNameEN ||
        match?.homeNameCN ||
        match?.homeTeamName ||
        match?.homeName ||
        match?.team1Name ||
        match?.home ||
        "主队"
    );
}

function getAwayName(match) {
    return (
        match?.oAwayName ||
        match?.awayNameEN ||
        match?.awayNameCN ||
        match?.awayTeamName ||
        match?.awayName ||
        match?.team2Name ||
        match?.away ||
        "客队"
    );
}

function getInplaySelectionLabel(pa) {
    const selection = pa?.na ?? pa?.NA ?? pa?.nA ?? pa?.pNa ?? pa?.n2 ?? pa?.N2 ?? "";
    return selection != null ? String(selection).trim() : "";
}

function normalizeNameToken(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/\s+/g, "")
        .replace(/[()]/g, "")
        .trim();
}

function normalizeResultCode(value, homeName, awayName) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const token = normalizeNameToken(raw);
    if (["1", "home", "主", "主队"].includes(token)) return "1";
    if (["2", "away", "客", "客队"].includes(token)) return "2";
    if (["x", "draw", "tie", "平", "平局"].includes(token)) return "X";
    const home = normalizeNameToken(homeName);
    const away = normalizeNameToken(awayName);
    if (home && token === home) return "1";
    if (away && token === away) return "2";
    return "";
}

function normalizeHomeAwayCode(value, homeName, awayName) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const token = normalizeNameToken(raw);
    if (["1", "home", "主", "主队"].includes(token)) return "1";
    if (["2", "away", "客", "客队"].includes(token)) return "2";
    const home = normalizeNameToken(homeName);
    const away = normalizeNameToken(awayName);
    if (home && token === home) return "1";
    if (away && token === away) return "2";
    return "";
}

function normalizeOverUnderCode(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const token = normalizeNameToken(raw);
    if (token.startsWith("over") || token === "大" || token === "大球") return "Over";
    if (token.startsWith("under") || token === "小" || token === "小球") return "Under";
    return "";
}

function normalizeDoubleChanceCode(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const token = raw.toUpperCase().replace(/\s+/g, "").replace(/[\/-]/g, "&");
    if (["1&X", "X&1", "1X"].includes(token)) return "1&X";
    if (["1&2", "2&1", "12"].includes(token)) return "1&2";
    if (["2&X", "X&2", "2X", "X2"].includes(token)) return "2&X";
    return "";
}

function normalizeHalfFullTimeCode(value, homeName, awayName) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const parts = raw.split(/[\/&-]/).map((part) => normalizeResultCode(part, homeName, awayName)).filter(Boolean);
    if (parts.length === 2) return `${parts[0]}&${parts[1]}`;
    return "";
}

function buildCanonicalTeamType({ betPlayId, rawSelection, homeName, awayName, optionOrder }) {
    const marketId = String(betPlayId ?? "").trim();
    const selection = String(rawSelection ?? "").trim();
    const order = optionOrder != null ? String(optionOrder).trim() : "";
    if (marketId === "40" || marketId === "1579" || marketId === "1777") {
        if (order === "0") return "1";
        if (order === "1") return "X";
        if (order === "2") return "2";
        return selection ? normalizeResultCode(selection, homeName, awayName) : "";
    }
    if (marketId === "938" || marketId === "12") {
        if (order === "0") return "1";
        if (order === "1") return "2";
        return selection ? normalizeHomeAwayCode(selection, homeName, awayName) : "";
    }
    if (marketId === "981" || marketId === "10143" || marketId === "421") {
        if (order === "0") return "Over";
        if (order === "1") return "Under";
        return selection ? normalizeOverUnderCode(selection) : "";
    }
    if (!selection) return "";
    if (marketId === "43" || marketId === "10001") return selection;
    if (marketId === "42") return normalizeHalfFullTimeCode(selection, homeName, awayName);
    if (marketId === "10257") return normalizeDoubleChanceCode(selection);
    return selection;
}

/** 解析 TU（Bet365 结果数据，UTC 时间 YYYYMMDDHHmmss）为 UTC 毫秒时间戳 */
function parseTUToUtcMs(tuStr) {
    if (tuStr == null || String(tuStr).length < 14) return null;
    const s = String(tuStr).padStart(14, "0");
    const year = parseInt(s.slice(0, 4), 10);
    const month = parseInt(s.slice(4, 6), 10) - 1;
    const day = parseInt(s.slice(6, 8), 10);
    const hour = parseInt(s.slice(8, 10), 10);
    const min = parseInt(s.slice(10, 12), 10);
    const sec = parseInt(s.slice(12, 14), 10);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
    return Date.UTC(year, month, day, hour, min, sec);
}

/** Bet365：TT 表示 playing(进行中) 或 break(休息/中场)。tt 为 0/"0"/false 视为 break */
function isTtBreak(mavo) {
    const v = mavo?.tt ?? mavo?.TT;
    if (v == null) return false;
    if (typeof v === "boolean") return !v;
    const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
    return n === 0;
}

/** 解析半场：Bet365 标准用 CP(CURRENT_PERIOD)：1=上半场 2=下半场。TT 官方含义为 playing/break，不能当半场用。无 CP 时用 TM（比赛分钟）推断：≤45 上半场，>45 下半场；再兜底用 tt 0=上 1=下 */
function parseHalfFromPayload(mavo) {
    const cp = mavo?.cp ?? mavo?.CP;
    if (cp != null && cp !== "") {
        const n = typeof cp === "string" ? parseInt(cp, 10) : Number(cp);
        if (n === 1) return 1;
        if (n === 2) return 2;
    }
    const tM = mavo?.tM ?? mavo?.TM;
    if (tM != null && tM !== "") {
        const n = typeof tM === "string" ? parseInt(tM, 10) : Number(tM);
        if (Number.isFinite(n)) return n <= 45 ? 1 : 2;
    }
    const tt = mavo?.tt ?? mavo?.TT;
    if (tt != null && tt !== "") {
        const n = typeof tt === "string" ? parseInt(tt, 10) : Number(tt);
        if (n === 0) return 1;
        if (n === 1) return 2;
    }
    return null;
}

/** 比赛开球时间（UTC 毫秒） */
function getKickoffMs(match) {
    const t = match?.time ?? match?.matchTime ?? match?.startTime ?? match?.eventTime;
    if (t == null) return null;
    return typeof t === "number" ? (t < 1e10 ? t * 1000 : t) : new Date(t).getTime();
}

/** 比赛时间统一按新加坡时间展示 */
function getMatchTime(match) {
    const t = match?.time ?? match?.matchTime ?? match?.startTime ?? match?.eventTime;
    if (t == null) return "-";
    const ts = typeof t === "number" ? t * (t < 1e10 ? 1000 : 1) : new Date(t).getTime();
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", {
        timeZone: "Asia/Singapore",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function findCurrentMatch(matchRaw, slipItem) {
    const matchList = getMatchListFromOddsResponse(matchRaw, slipItem?.type === "inplay" ? 1 : 0);
    const targetEventId = String(slipItem?.eventId ?? "");
    const targetBet365Id = String(slipItem?.bet365Id ?? "");
    return matchList.find((match) => {
        const eventId = String(match?.id ?? "");
        const bet365Id = String(match?.bet365Id ?? match?.id ?? "");
        return (targetEventId && eventId === targetEventId) || (targetBet365Id && bet365Id === targetBet365Id);
    }) || null;
}

function refreshSlipItemFromCurrentOdds(slipItem, matchRaw) {
    if (!slipItem || !matchRaw) return slipItem;
    const currentMatch = findCurrentMatch(matchRaw, slipItem);
    if (!currentMatch) return slipItem;

    if (slipItem.type === "pre") {
        const oddsMap = currentMatch?.odds ?? {};
        const marketKey = slipItem.marketKey;
        const oddsObj = marketKey ? oddsMap?.[marketKey] : null;
        const currentItem = Array.isArray(oddsObj?.odds)
            ? oddsObj.odds.find((it) => String(it?.id ?? "") === String(slipItem?.oddingId ?? ""))
            : null;
        if (!currentItem) {
            return { ...slipItem, match: currentMatch };
        }
        const atTime = oddsObj?.updateAt ?? oddsObj?.at_time ?? currentItem?.updateAt ?? currentItem?.at_time ?? slipItem.at_time ?? null;
        const nextOdds = parseFloat(currentItem?.odds);
        return {
            ...slipItem,
            match: currentMatch,
            item: currentItem,
            oddsObj,
            odds: Number.isFinite(nextOdds) ? nextOdds : slipItem.odds,
            handicap: currentItem?.handicap != null ? String(currentItem.handicap) : (slipItem.handicap ?? ""),
            teamType: buildCanonicalTeamType({
                betPlayId: slipItem?.betPlayId,
                rawSelection: currentItem?.team ?? currentItem?.header ?? currentItem?.name ?? currentItem?.handicap ?? "",
                homeName: getHomeName(currentMatch),
                awayName: getAwayName(currentMatch),
                optionOrder: currentItem?.or ?? currentItem?.OR,
            }) || (slipItem.teamType ?? ""),
            at_time: atTime,
            timeStr: atTime != null ? String(atTime) : "",
            selectionText: `${getHomeName(currentMatch)} vs ${getAwayName(currentMatch)} ${slipItem.label} ${currentItem?.name != null ? currentItem.name : currentItem?.handicap} @${currentItem?.odds}`,
        };
    }

    const tree = Array.isArray(currentMatch?.treeResults) ? currentMatch.treeResults : [];
    const currentMavo = tree.find((m) => String(m?.id ?? m?.ID ?? "") === String(slipItem?.paId ?? ""));
    const currentPa = currentMavo?.co?.flatMap((c) => c?.pa || []).find((pa) => String(pa?.id ?? pa?.ID ?? "") === String(slipItem?.oddingId ?? ""));
    if (!currentMavo || !currentPa) {
        return { ...slipItem, match: currentMatch };
    }
    const atTime = currentMavo?.updateAt ?? currentMavo?.UpdateAt ?? slipItem.at_time ?? null;
    const odRaw = currentPa?.od ?? currentPa?.OD ?? "";
    const odDecimal = inplayOddsToDecimal(odRaw);
    const selectionLabel = getInplaySelectionLabel(currentPa);
    const selectionLabelText = selectionLabel ? ` ${selectionLabel}` : "";
    return {
        ...slipItem,
        match: currentMatch,
        mavo: currentMavo,
        pa: currentPa,
        odds: odDecimal != null ? odDecimal : slipItem.odds,
        handicap: (currentPa?.ha ?? currentPa?.HA) != null ? String(currentPa?.ha ?? currentPa?.HA) : (slipItem.handicap ?? ""),
        teamType: buildCanonicalTeamType({
            betPlayId: slipItem?.betPlayId,
            rawSelection: currentPa?.pNa ?? currentPa?.n2 ?? currentPa?.N2 ?? currentPa?.na ?? currentPa?.NA ?? selectionLabel,
            homeName: getHomeName(currentMatch),
            awayName: getAwayName(currentMatch),
            optionOrder: currentPa?.or ?? currentPa?.OR,
        }) || (slipItem.teamType ?? ""),
        at_time: atTime,
        timeStr: atTime != null ? String(atTime) : "",
        selectionText: `${getHomeName(currentMatch)} vs ${getAwayName(currentMatch)} ${currentMavo?.na ?? currentMavo?.NA ?? ""}${selectionLabelText} @${odRaw}`,
    };
}

function getScore(match) {
    if (match?.score) return match.score;
    if (match?.ballScore != null && typeof match.ballScore === "string") return match.ballScore;
    if (match?.homeScore !== undefined || match?.awayScore !== undefined) {
        return `${match?.homeScore ?? 0} : ${match?.awayScore ?? 0}`;
    }
    return "-";
}

/** 滚球进行时间展示：上半场/下半场 XX分XX秒。TT=break 时停止读秒，只显示推送的 TM/TS */
function getLiveClockDisplay(match, nowTick) {
    if (match?.timeStatus !== "1") return null;
    const baseMin = match?.liveClockMinute ?? 0;
    const baseSec = match?.liveClockSecond ?? 0;
    const updatedAt = match?.liveClockUpdatedAt;
    if (updatedAt == null && baseMin === 0 && baseSec === 0) return null;
    const baseTotalSec = baseMin * 60 + baseSec;
    const onBreak = match?.liveClockOnBreak === true;
    const elapsedSec = onBreak ? 0 : (updatedAt != null && nowTick != null ? Math.max(0, Math.floor((nowTick - updatedAt) / 1000)) : 0);
    const totalSec = baseTotalSec + elapsedSec;
    const half = match?.liveHalf ?? (baseMin < 45 ? 1 : 2);
    const halfLabel = half === 1 ? "上半场" : "下半场";
    const isPeriodTime = match?.liveClockIsPeriodTime === true;
    const displayMin = isPeriodTime
        ? Math.floor(totalSec / 60)
        : (half === 1 ? Math.floor(totalSec / 60) : Math.floor((totalSec - 45 * 60) / 60));
    const displaySec = isPeriodTime
        ? Math.floor(totalSec % 60)
        : (half === 1 ? Math.floor(totalSec % 60) : Math.floor((totalSec - 45 * 60) % 60));
    const safeMin = Math.max(0, displayMin);
    const safeSec = Math.max(0, Math.min(59, displaySec));
    return `${halfLabel} ${safeMin}分${String(safeSec).padStart(2, "0")}秒`;
}

/** 滚球赔率 分数转小数 (如 "4/5" -> 1.8，即 4/5+1) */
function inplayOddsToDecimal(od) {
    if (od == null || od === "" || od === "-") return null;
    const s = String(od).trim();
    const parts = s.split("/").map((p) => parseFloat(p.trim()));
    if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || parts[1] === 0) return null;
    return Math.floor((parts[0] / parts[1] + 1) * 100) / 100;
}

// 主要玩法展示顺序（bet365 风格）
const MAIN_MARKET_KEYS = [
    { key: "40_full_time_result", label: "胜平负" },
    { key: "938_asian_handicap", label: "亚盘" },
    { key: "981_goals_over_under", label: "大小球" },
    { key: "10143_goal_line", label: "球半" },
    { key: "43_correct_score", label: "波胆" },
    { key: "1579_half_time_result", label: "半场胜平负" },
    { key: "10257_half_time_double_chance", label: "半场双重机会" },
    { key: "42_half_time_full_time", label: "半&全场" },
];

/** 新加坡时间当天 0 点的毫秒时间戳 */
function getStartOfDaySingapore(date) {
    const f = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const [y, m, d] = f.format(date).split("-").map(Number);
    return Date.UTC(y, m - 1, d, -8, 0, 0);
}

function getDateTabLabel(dayIndex) {
    if (dayIndex === 0) return "今日";
    if (dayIndex === 1) return "明天";
    if (dayIndex === 2) return "后天";
    const start = getStartOfDaySingapore(new Date()) + dayIndex * 24 * 3600 * 1000;
    const d = new Date(start);
    return d.toLocaleDateString("zh-CN", {
        timeZone: "Asia/Singapore",
        month: "numeric",
        day: "numeric",
    });
}

// day = 新加坡“选中日”0 点的时间戳(ms)，与后端一致
function getSelectedDayTimestamp(dayIndex) {
    const now = new Date();
    return getStartOfDaySingapore(now) + dayIndex * 24 * 3600 * 1000;
}

function MarketOddsCell({ marketKey, label, oddsObj, match, onAddSlip }) {
    if (!oddsObj?.odds?.length) return null;
    const list = oddsObj.odds;
    const [bid, ...rest] = (marketKey || "").split("_");
    const betPlayId = bid || "";
    const betPlayName = rest.length ? rest.join("_") : marketKey || "";
    const bigTypeName = bid || "";

    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{label || oddsObj.name}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {list.map((item, i) => (
                    <span
                        key={item.id || i}
                        role="button"
                        tabIndex={0}
                        onClick={() => onAddSlip?.({ type: "pre", match, marketKey, label: label || oddsObj.name, item, oddsObj, betPlayId, betPlayName, bigTypeName })}
                        onKeyDown={(e) => e.key === "Enter" && onAddSlip?.({ type: "pre", match, marketKey, label: label || oddsObj.name, item, oddsObj, betPlayId, betPlayName, bigTypeName })}
                        style={{
                            fontSize: 13,
                            padding: "4px 10px",
                            background: "#f3f4f6",
                            borderRadius: 6,
                            color: "#111827",
                            cursor: onAddSlip ? "pointer" : "default",
                        }}
                    >
                        {item.header ? `${item.header} ` : ""}
                        {item.name != null ? item.name : item.handicap}
                        <span style={{ marginLeft: 6, fontWeight: 600 }}>{item.odds}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

/** 滚球：是否展示该玩法（至少有一项有名称；赔率为 "-" 的项也会展示，表示不可下注） */
function isMavoDisplayable(mavo) {
    const options = mavo?.co?.flatMap((c) => c.pa || []) ?? [];
    if (options.length === 0) return false;
    return options.some((pa) => {
        const name = pa?.na ?? pa?.NA ?? pa?.pNa ?? "";
        return name !== "" && String(name).trim() !== "";
    });
}

/** 滚球：单个玩法（MAVO）展示，co[].pa 为选项，na/pNa 名称，od 赔率；推送 "-" 表示不可下注，界面也显示 "-" 且不可点 */
function RollingMarketCell({ mavo, match, onAddSlip, highlight }) {
    const allOptions = mavo?.co?.flatMap((c) => c.pa || []) ?? [];
    const options = allOptions;
    if (options.length === 0) return null;
    const title = mavo.na || mavo.NA || mavo.id || mavo.ID || "";

    const isThisMarketHighlighted =
        highlight &&
        (String(match?.id) === String(highlight.eventId) || String(match?.bet365Id) === String(highlight.eventId)) &&
        (String(mavo?.id) === String(highlight.maId) || String(mavo?.ID) === String(highlight.maId));
    const changedPaIds = isThisMarketHighlighted && Array.isArray(highlight.changedPaIds) ? highlight.changedPaIds : [];

    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{title}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {options.map((pa, i) => {
                    const paId = pa?.id != null ? String(pa.id) : pa?.ID != null ? String(pa.ID) : null;
                    const isPaHighlighted = changedPaIds.length > 0 && paId != null && changedPaIds.includes(paId);
                    const odRaw = pa?.od ?? pa?.OD ?? "";
                    const isSuspended = odRaw === "" || String(odRaw).trim() === "" || String(odRaw).trim() === "-";
                    const odDecimal = inplayOddsToDecimal(odRaw);
                    const canAdd = onAddSlip && paId && odDecimal != null && !isSuspended;
                    const displayOdds = isSuspended ? "-" : odRaw;
                    return (
                        <span
                            key={paId || i}
                            className={isPaHighlighted ? "odds-updated-flash" : ""}
                            role="button"
                            tabIndex={canAdd ? 0 : undefined}
                            onClick={() => canAdd && onAddSlip({ type: "inplay", match, mavo, pa, odDecimal })}
                            onKeyDown={(e) => canAdd && e.key === "Enter" && onAddSlip({ type: "inplay", match, mavo, pa, odDecimal })}
                            style={{
                                fontSize: 13,
                                padding: "4px 10px",
                                background: isSuspended ? "#f9fafb" : "#f3f4f6",
                                borderRadius: 6,
                                color: isSuspended ? "#9ca3af" : "#111827",
                                cursor: canAdd ? "pointer" : "default",
                            }}
                        >
                            {(pa.na != null && pa.na !== "") ? pa.na : (pa.pNa != null ? pa.pNa : (pa.NA != null ? pa.NA : "-"))}
                            {(pa.ha != null && String(pa.ha).trim() !== "") || (pa.HA != null && String(pa.HA).trim() !== "") ? (
                                <span style={{ color: "#6b7280", marginLeft: 4 }}>({pa.ha ?? pa.HA})</span>
                            ) : null}
                            <span style={{ marginLeft: 6, fontWeight: 600 }}>{displayOdds}</span>
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

export default function SoccerEarlyMarketPage() {
    const [baseUrl, setBaseUrl] = useState("https://ball.skybit.shop");
    const [authReady, setAuthReady] = useState(false);
    const [sportId, setSportId] = useState(1);
    const [type, setType] = useState("0");

    const [leagueList, setLeagueList] = useState([]);
    const [selectedLeague, setSelectedLeague] = useState(null);

    const [leagueLoading, setLeagueLoading] = useState(false);
    const [matchLoading, setMatchLoading] = useState(false);
    const [error, setError] = useState("");

    const [matchRaw, setMatchRaw] = useState(null);

    /** 用于 WS 回调中拿到当前选中的联赛，避免闭包陈旧 */
    const selectedLeagueRef = useRef(selectedLeague);
    selectedLeagueRef.current = selectedLeague;
    const [highlight, setHighlight] = useState(null);
    const highlightTimerRef = useRef(null);
    const mergeTimerRef = useRef(null);

    /** WS 推送控制台：最近 N 条。每项 { id, ts, type, ... }，type 为 in_play_odds_update | inplay_league | league */
    const [wsOddsConsoleLog, setWsOddsConsoleLog] = useState([]);
    const WS_CONSOLE_MAX = 30;
    /** 控制台筛选项：topic（in_play_odds_update / inplay_league / league）、eventId / maId（主要筛滚球赔率） */
    const [wsConsoleFilterTopic, setWsConsoleFilterTopic] = useState("");
    const [wsConsoleFilterEventId, setWsConsoleFilterEventId] = useState("");
    const [wsConsoleFilterMaId, setWsConsoleFilterMaId] = useState("");
    const wsConsoleIdRef = useRef(0);
    /** 向控制台插入一条（新条在最前，用自增 id 保证时间顺序） */
    const pushWsConsole = useCallback((entry) => {
        const id = ++wsConsoleIdRef.current;
        const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        setWsOddsConsoleLog((log) => [{ id, ts, ...entry }, ...log.slice(0, WS_CONSOLE_MAX - 1)]);
    }, []);
    /** 去重：避免同一条 WS 消息被处理两次（如 Strict Mode 双连接）导致控制台显示两条 */
    const lastProcessedRef = useRef({ key: "", ts: 0 });

    /** 滚球进行时间读秒：每秒更新，用于 getLiveClockDisplay(match, clockTick) */
    const [clockTick, setClockTick] = useState(() => Date.now());

    /** 投注单：每项 { key, type:'pre'|'inplay', match, ... } */
    const [betSlip, setBetSlip] = useState([]);
    const [confirmStep, setConfirmStep] = useState(false);
    const [betAmount, setBetAmount] = useState("");
    const [isBestOdd, setIsBestOdd] = useState(true);
    const [submitLoading, setSubmitLoading] = useState(false);
    const [submitError, setSubmitError] = useState("");
    /** 订单列表 / 结算 */
    const [orderList, setOrderList] = useState([]);
    const [orderListTotal, setOrderListTotal] = useState(0);
    const [orderListLoading, setOrderListLoading] = useState(false);
    /** 订单列表 Tab：'unsettled' 未结算，'other' 其他（结算失败+已结算） */
    const [orderListTab, setOrderListTab] = useState("unsettled");
    const [orderFlow, setOrderFlow] = useState(null);
    const [userBalance, setUserBalance] = useState(null);
    const slipKeyRef = useRef(0);

    /** 玩法集合：type=1 早盘 type=5 滚球 type=6 其他；按 type -> smallId -> { betName, samllName, smallId } */
    const [associationList, setAssociationList] = useState([]);
    const associationMap = useMemo(() => {
        const map = new Map();
        const list = Array.isArray(associationList) ? associationList : [];
        list.forEach((vo) => {
            const t = vo.type != null ? Number(vo.type) : null;
            if (t == null) return;
            const arr = vo.value;
            if (!Array.isArray(arr)) return;
            const bySmall = new Map();
            arr.forEach((item) => {
                const sid = item.smallId != null ? item.smallId : item.small_id;
                if (sid == null) return;
                bySmall.set(String(sid), {
                    betName: item.betName ?? item.bet_name ?? "",
                    samllName: item.samllName ?? item.samll_name ?? item.small_name ?? "",
                    smallId: sid,
                });
            });
            map.set(t, bySmall);
        });
        return map;
    }, [associationList]);

    // 日期 Tab：0=今日，1..9=往后 9 天
    const [selectedDayIndex, setSelectedDayIndex] = useState(0);
    const selectedDayTs = getSelectedDayTimestamp(selectedDayIndex);


    useEffect(() => {
        setAuthReady(true);
    }, []);

    const matchList = useMemo(
        () => getMatchListFromOddsResponse(matchRaw, type),
        [matchRaw, type]
    );

    const handleOddsUpdate = (mavo) => {
        const normalized = normalizeMavoFromWs(mavo);
        if (!normalized) return;
        const dedupeKey = `${normalized.eventId ?? ""}_${normalized.id ?? ""}_${JSON.stringify((normalized?.co ?? []).flatMap((c) => c.pa || []).slice(0, 8).map((pa) => pa?.od ?? pa?.OD))}`;
        const now = Date.now();
        if (lastProcessedRef.current.key === dedupeKey && now - lastProcessedRef.current.ts < 500) {
            return;
        }
        lastProcessedRef.current = { key: dedupeKey, ts: now };

        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        if (mergeTimerRef.current) {
            clearTimeout(mergeTimerRef.current);
            mergeTimerRef.current = null;
        }

        setMatchRaw((prev) => {
            const changedPaIds = getChangedPaIds(prev, normalized);
            const merged = mergeMavoIntoMatchRaw(prev, normalized);

            if (changedPaIds.length > 0) {
                setHighlight({
                    eventId: normalized.eventId != null ? String(normalized.eventId) : null,
                    maId: normalized.id,
                    changedPaIds,
                });
                highlightTimerRef.current = setTimeout(() => {
                    setHighlight(null);
                    highlightTimerRef.current = null;
                }, 500);
            }

            const oddsStrs = (normalized?.co ?? [])
                .flatMap((c) => c.pa || [])
                .slice(0, 8)
                .map((pa) => pa?.od ?? pa?.OD ?? "-");
            const summary = oddsStrs.length > 0 ? oddsStrs.join("|") : "-";
            pushWsConsole({
                type: "in_play_odds_update",
                eventId: normalized.eventId != null ? String(normalized.eventId) : null,
                maId: normalized.id != null ? String(normalized.id) : "-",
                maName: normalized.na ?? normalized.NA ?? "-",
                summary,
                changedPaIds: changedPaIds.slice(),
                oddsUnchanged: changedPaIds.length === 0,
                mergeSuccess: true,
            });

            return merged;
        });
    };

    const handleEventResult = useCallback((snapshot) => {
        if (!snapshot) return;
        const list = Array.isArray(snapshot) ? snapshot : (snapshot.events && Array.isArray(snapshot.events) ? snapshot.events : [snapshot]);
        setMatchRaw((prev) => {
            if (!prev) return prev;
            const cloned = { ...prev };
            const data = cloned?.data?.data ?? cloned?.data ?? cloned;
            const inPlay = data?.inPlay;
            if (!Array.isArray(inPlay)) return prev;
            let updated = false;
            for (const item of list) {
                const eventIdStr = item.eventId != null ? String(item.eventId) : (item.bet365Id != null ? String(item.bet365Id) : null);
                if (!eventIdStr) continue;
                const timeStatus = item.timeStatus != null ? String(item.timeStatus) : null;
                const minute = item.tm != null ? Number(item.tm) : null;
                const second = item.ts != null ? Number(item.ts) : null;
                const scoreStr = item.ss != null ? String(item.ss) : (item.ballScore != null ? String(item.ballScore) : null);
                const liveMin = Number.isFinite(minute) ? Math.max(0, minute) : null;
                const liveSec = Number.isFinite(second) ? Math.max(0, Math.min(59, second)) : null;
                const liveHalf = liveMin != null ? (liveMin <= 45 ? 1 : 2) : null;

                outer: for (const group of inPlay) {
                    const value = group?.value;
                    if (!Array.isArray(value)) continue;
                    for (let i = 0; i < value.length; i++) {
                        const match = value[i];
                        const mid = match?.id != null ? String(match.id) : match?.bet365Id != null ? String(match.bet365Id) : null;
                        if (mid !== eventIdStr) continue;
                        const next = { ...match };
                        if (timeStatus != null) next.timeStatus = timeStatus;
                        if (liveMin != null || liveSec != null) {
                            next.liveClockMinute = liveMin != null ? liveMin : (next.liveClockMinute ?? 0);
                            next.liveClockSecond = liveSec != null ? liveSec : (next.liveClockSecond ?? 0);
                            next.liveClockUpdatedAt = Date.now();
                            next.liveHalf = liveHalf != null ? liveHalf : (next.liveClockMinute <= 45 ? 1 : 2);
                            next.liveClockIsPeriodTime = true;
                            next.liveClockOnBreak = false;
                        }
                        if (scoreStr != null) {
                            next.ballScore = scoreStr;
                        }
                        value[i] = next;
                        updated = true;
                        break outer;
                    }
                }
            }
            return updated ? cloned : prev;
        });
    }, []);

    // 滚球时只订阅当前列表中的比赛 id，服务端按 eventId 推送
    const eventIds = useMemo(() => {
        // 新方案：不再按 eventId 订阅赔率，仅按 league 订阅；这里固定返回空数组
        return [];
    }, [type, matchList]);

    const { connected: wsConnected } = useOddsSocket({
        baseUrl,
        enabled: type === "1",
        eventIds,
        leagueId: selectedLeague?.leagueId ?? null,
        onOddsUpdate: handleOddsUpdate,
        onCornersCards: undefined,
        onEventResult: handleEventResult,
        onInplayLeagueUpdate: (data) => {
            const list = Array.isArray(data) ? data : (data?.data ?? []);
            const count = Array.isArray(list) ? list.length : 0;
            pushWsConsole({
                type: "inplay_league",
                count,
                detail: {
                    payloadKeys: data != null && typeof data === "object" ? Object.keys(data) : [],
                    payloadSample: data != null ? JSON.stringify(data).slice(0, 400) : "",
                    leagueIds: Array.isArray(list) ? list.map((l) => l?.leagueId ?? l?.league_id).filter(Boolean) : [],
                },
            });
            getLeagueGroup({
                baseUrl,
                type,
                sportId,
                day: type === "1" ? undefined : selectedDayTs,
                daysOfTime: type === "1" ? undefined : 1,
            })
                .then((res) => {
                    const apiList = Array.isArray(res?.data?.data) ? res.data.data : [];
                    setLeagueList(apiList);
                    pushWsConsole({
                        type: "inplay_league",
                        count: apiList.length,
                        detail: { afterRefetch: true, apiCount: apiList.length },
                    });
                })
                .catch((err) => {
                    pushWsConsole({
                        type: "inplay_league",
                        count: 0,
                        detail: { refetchError: err?.message ?? String(err) },
                    });
                });
        },
        onLeagueEventsUpdate: (data) => {
            const leagueId = data?.leagueId != null ? String(data.leagueId) : null;
            if (leagueId == null) return;
            const inPlay = data?.data?.inPlay ?? data?.inPlay;
            const matchCount = Array.isArray(inPlay) ? inPlay.reduce((acc, g) => acc + (Array.isArray(g?.value) ? g.value.length : 0), 0) : 0;
            const eventIdsFromPush = Array.isArray(inPlay) ? inPlay.flatMap((g) => (g?.value ?? []).map((m) => m?.id ?? m?.bet365Id).filter(Boolean)) : [];
            const isSelected = String(selectedLeagueRef.current?.leagueId) === leagueId;
            pushWsConsole({
                type: "league",
                leagueId,
                matchCount,
                detail: {
                    inPlayGroups: Array.isArray(inPlay) ? inPlay.length : 0,
                    eventIds: eventIdsFromPush,
                    payloadKeys: data ? Object.keys(data) : [],
                    payloadSample: data ? JSON.stringify(data).slice(0, 400) : "",
                    isSelectedLeague: isSelected,
                },
            });

            if (!isSelected) return;
            const league = selectedLeagueRef.current;
            if (!league?.leagueId) return;
            getBet365All({
                baseUrl,
                day: type === "1" ? undefined : selectedDayTs,
                leagueIds: league.leagueId,
                daysOfTime: type === "1" ? undefined : 1,
            })
                .then((res) => {
                    setMatchRaw((prev) => mergeMatchRawPreferNewer(prev, {
                        request: {
                            leagueName: league.leagueName ?? "",
                            leagueId: league.leagueId ?? "",
                            day: type === "1" ? undefined : selectedDayTs,
                            daysOfTime: type === "1" ? undefined : 1,
                        },
                        ...res,
                    }));
                    const apiInPlay = res?.data?.inPlay ?? res?.data?.data?.inPlay ?? res?.inPlay;
                    const apiCount = Array.isArray(apiInPlay) ? apiInPlay.reduce((a, g) => a + (Array.isArray(g?.value) ? g.value.length : 0), 0) : 0;
                    pushWsConsole({
                        type: "league",
                        leagueId,
                        matchCount: apiCount,
                        detail: { afterRefetch: true, apiMatchCount: apiCount },
                    });
                })
                .catch((err) => {
                    pushWsConsole({
                        type: "league",
                        leagueId,
                        matchCount: 0,
                        detail: { refetchError: err?.message ?? String(err) },
                    });
                });
        },
    });

    useEffect(() => {
        if (type !== "1" || !matchList?.length) return;
        const id = setInterval(() => setClockTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [type, matchList?.length]);

    const loadLeagues = async () => {
        setError("");
        setLeagueLoading(true);
        setSelectedLeague(null);
        setMatchRaw(null);

        try {
            const res = await getLeagueGroup({
                baseUrl,
                type,
                sportId,
                day: type === "1" ? undefined : selectedDayTs,
                daysOfTime: type === "1" ? undefined : 1,
            });

            const list = Array.isArray(res?.data?.data) ? res.data.data : [];
            setLeagueList(list);

            if (list.length > 0) {
                setSelectedLeague(list[0]);
            } else {
                setSelectedLeague(null);
            }
        } catch (err) {
            setError(err.message || "获取联赛列表失败");
            setLeagueList([]);
        } finally {
            setLeagueLoading(false);
        }
    };

    const loadMatchesByLeague = async (league) => {
        if (!league?.leagueId) return;

        setError("");
        setSelectedLeague(league);
        setMatchLoading(true);

        try {
            const res = await getBet365All({
                baseUrl,
                day: type === "1" ? undefined : selectedDayTs,
                leagueIds: league.leagueId,
                daysOfTime: type === "1" ? undefined : 1,
            });

            setMatchRaw((prev) => mergeMatchRawPreferNewer(prev, {
                request: {
                    leagueName: league.leagueName ?? "",
                    leagueId: league.leagueId ?? "",
                    day: type === "1" ? undefined : selectedDayTs,
                    daysOfTime: type === "1" ? undefined : 1,
                },
                ...res,
            }));
        } catch (err) {
            setError(err.message || "获取比赛列表失败");
            setMatchRaw(null);
        } finally {
            setMatchLoading(false);
        }
    };

    // 初始加载 + 切换日期/type/sportId 时刷新联赛列表
    useEffect(() => {
        loadLeagues();
    }, [selectedDayIndex, type, sportId]);

    /** 赔率界面先请求玩法集合（association），再请求联赛/比赛 */
    const loadAssociation = useCallback(async () => {
        if (!baseUrl) return;
        try {
            const res = await getAssociation({ baseUrl });
            const list = res?.data?.data ?? res?.data ?? [];
            setAssociationList(Array.isArray(list) ? list : []);
        } catch {
            setAssociationList([]);
        }
    }, [baseUrl]);

    useEffect(() => {
        loadAssociation();
    }, [loadAssociation]);

    // 早盘、滚球均需选中联赛（leagueId）后才请求比赛列表；未选中则清空列表
    useEffect(() => {
        if (selectedLeague?.leagueId) {
            loadMatchesByLeague(selectedLeague);
        } else {
            setMatchRaw(null);
        }
    }, [selectedLeague?.leagueId, selectedLeague?.leagueName, selectedDayTs, type]);

    const addToSlip = useCallback((payload) => {
        if (payload.type === "pre") {
            const { match, marketKey, label, item, oddsObj, betPlayName: _bpName } = payload;
            const odds = parseFloat(item.odds);
            if (!Number.isFinite(odds) || !match?.id) return;
            // 赔率里的 at_time：早盘用 oddsObj 的 updateAt 或 at_time
            const atTime = oddsObj?.updateAt ?? oddsObj?.at_time ?? item?.updateAt ?? item?.at_time ?? null;
            const timeStr = atTime != null ? String(atTime) : "";
            // 用赔率玩法 id（如 marketKey 的 938、10257）去 association 里查，不是选项 id(item.id)
            const playSmallId = marketKey ? String(marketKey.split("_")[0]) : "";
            const assocByType = associationMap.get(1);
            const assoc = assocByType && playSmallId ? assocByType.get(playSmallId) : null;
            const bigTypeName = assoc?.betName ?? "";
            const betPlayName = assoc?.samllName ?? _bpName ?? (marketKey ? marketKey.split("_").slice(1).join("_") : "");
            const betPlayId = assoc != null ? String(assoc.smallId) : playSmallId;
            setBetSlip((prev) => {
                const nextItem = {
                    key: `pre_${match.id}_${item.id}_${slipKeyRef.current++}`,
                    type: "pre",
                    match,
                    marketKey,
                    label,
                    item,
                    eventId: String(match.id),
                    bet365Id: String(match.bet365Id ?? match.id),
                    timeType: 0,
                    oddingId: String(item.id),
                    handicap: item.handicap != null ? String(item.handicap) : "",
                    odds,
                    betPlayId,
                    betPlayName,
                    bigTypeName,
                    oddsMarkets: marketKey,
                    at_time: atTime,
                    timeStr,
                    teamType: buildCanonicalTeamType({
                        betPlayId,
                        rawSelection: item.team ?? item.header ?? item.name ?? item.handicap ?? "",
                        homeName: getHomeName(match),
                        awayName: getAwayName(match),
                    }),
                    selectionText: `${getHomeName(match)} vs ${getAwayName(match)} ${label} ${item.name != null ? item.name : item.handicap} @${item.odds}`,
                };
                const next = [...prev, nextItem];
                if (hasDuplicateEventIdInSlip(next)) {
                    setSubmitError("串关不支持同一场比赛选择多个投注项");
                    return prev;
                }
                setSubmitError("");
                return next;
            });
        } else {
            const { match, mavo, pa, odDecimal } = payload;
            const paIdVal = pa?.id ?? pa?.ID;
            const mavoIdVal = mavo?.id ?? mavo?.ID;
            if (!match?.id && !match?.bet365Id) return;
            if (paIdVal == null || paIdVal === "") return;
            if (odDecimal == null) return;
            // 滚球：赔率里的 at_time 用 mavo.updateAt；timeStr 与 time 同一值
            const atTime = mavo?.updateAt ?? mavo?.UpdateAt ?? null;
            const timeStr = atTime != null ? String(atTime) : "";
            // 滚球：用玩法 id（mavo.id，类似早盘的 938）去 association 里查
            const playSmallId = mavoIdVal != null ? String(mavoIdVal) : "";
            const assocByType = associationMap.get(5);
            const assoc = assocByType && playSmallId ? assocByType.get(playSmallId) : null;
            const bigTypeName = assoc?.betName ?? "";
            const betPlayName = assoc?.samllName ?? "";
            const betPlayId = assoc != null ? String(assoc.smallId) : playSmallId;
            const eventIdStr = String(match.id ?? match.bet365Id ?? "");
            const bet365IdStr = String(match.bet365Id ?? match.id ?? "");
            const odRaw = pa?.od ?? pa?.OD ?? "";
            const selectionLabel = getInplaySelectionLabel(pa);
            const selectionLabelText = selectionLabel ? ` ${selectionLabel}` : "";
            setBetSlip((prev) => {
                const nextItem = {
                    key: `in_${eventIdStr}_${mavoIdVal}_${paIdVal}_${slipKeyRef.current++}`,
                    type: "inplay",
                    match,
                    mavo,
                    pa,
                    eventId: eventIdStr,
                    bet365Id: bet365IdStr,
                    timeType: 1,
                    oddingId: String(paIdVal),
                    paId: mavoIdVal != null ? String(mavoIdVal) : "",
                    handicap: (pa?.ha ?? pa?.HA) != null ? String(pa.ha ?? pa.HA) : "",
                    odds: odDecimal,
                    oddsMarkets: "inplay",
                    betPlayId,
                    betPlayName,
                    bigTypeName,
                    at_time: atTime,
                    timeStr,
                    teamType: buildCanonicalTeamType({
                        betPlayId,
                        rawSelection: pa?.pNa ?? pa?.n2 ?? pa?.N2 ?? pa?.na ?? pa?.NA ?? selectionLabel,
                        homeName: getHomeName(match),
                        awayName: getAwayName(match),
                        optionOrder: pa?.or ?? pa?.OR,
                    }),
                    selectionText: `${getHomeName(match)} vs ${getAwayName(match)} ${mavo?.na ?? mavo?.NA ?? ""}${selectionLabelText} @${odRaw}`,
                };
                const next = [...prev, nextItem];
                if (hasDuplicateEventIdInSlip(next)) {
                    setSubmitError("串关不支持同一场比赛选择多个投注项");
                    return prev;
                }
                setSubmitError("");
                return next;
            });
        }
    }, [associationMap, setSubmitError]);

    const removeFromSlip = (key) => setBetSlip((prev) => prev.filter((x) => x.key !== key));

    const isScoreMarketOrder = (betPlayId, betPlayName, oddsMarkets) => {
        const marketId = String(betPlayId || "");
        const name = `${betPlayName || ""} ${oddsMarkets || ""}`.toLowerCase();
        return (
            marketId === "40" ||
            marketId === "42" ||
            marketId === "43" ||
            marketId === "10001" ||
            marketId === "10540" ||
            marketId === "10561" ||
            marketId === "50591" ||
            marketId === "50275" ||
            name.includes("correct_score") ||
            name.includes("final score") ||
            name.includes("波胆")
        );
    };

    const hasDuplicateEventIdInSlip = (slip) => {
        const seen = new Set();
        for (const item of slip) {
            const eventId = item?.eventId != null ? String(item.eventId) : "";
            if (!eventId) continue;
            if (seen.has(eventId)) return true;
            seen.add(eventId);
        }
        return false;
    };

    const slipToBetOrder = (item) => {
        const canonicalTeamType = item.type === "inplay"
            ? buildCanonicalTeamType({
                betPlayId: item.betPlayId,
                rawSelection: item?.pa?.pNa ?? item?.pa?.n2 ?? item?.pa?.N2 ?? item?.pa?.na ?? item?.pa?.NA ?? getInplaySelectionLabel(item?.pa),
                homeName: getHomeName(item?.match),
                awayName: getAwayName(item?.match),
                optionOrder: item?.pa?.or ?? item?.pa?.OR,
            })
            : buildCanonicalTeamType({
                betPlayId: item.betPlayId,
                rawSelection: item?.item?.team ?? item?.item?.header ?? item?.item?.name ?? item?.item?.handicap ?? "",
                homeName: getHomeName(item?.match),
                awayName: getAwayName(item?.match),
                optionOrder: item?.item?.or ?? item?.item?.OR,
            });
        const base = {
            eventId: item.eventId,
            bet365Id: item.bet365Id,
            odds: item.odds,
            timeType: item.timeType,
            oddingId: item.oddingId,
            handicap: item.handicap ?? "",
            oddsMarkets: item.oddsMarkets ?? "",
            betPlayId: item.betPlayId ?? "",
            betPlayName: item.betPlayName ?? "",
            bigTypeName: item.bigTypeName ?? "",
            teamType: canonicalTeamType || "",
            // 下单接口 time/timeStr 用赔率里的 at_time，timeStr 与 time 同一值
            time: item.at_time ?? undefined,
            timeStr: item.timeStr ?? (item.at_time != null ? String(item.at_time) : ""),
        };
        if (item.type === "inplay") base.paId = item.paId ?? "";
        return base;
    };

    const loadOrderList = useCallback(async (tab) => {
        const isUnsettled = tab !== "other";
        setOrderListLoading(true);
        try {
            const res = await getOrderList({
                baseUrl,
                type: isUnsettled ? 0 : 1,
                page: 1,
                size: 50,
                ...(isUnsettled ? {} : { day: getSelectedDayTimestamp(0) }),
            });
            const page = res?.data?.data;
            const list = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page : [];
            setOrderList(list);
            setOrderListTotal(page?.total ?? list.length);
        } catch {
            setOrderList([]);
            setOrderListTotal(0);
        } finally {
            setOrderListLoading(false);
        }
    }, [baseUrl]);

    const loadOrderListCurrentTab = useCallback(() => {
        loadOrderList(orderListTab);
    }, [loadOrderList, orderListTab]);

    const loadOrderFlow = useCallback(async () => {
        try {
            const res = await getOrderFlow({ baseUrl });
            // 后端 ok(SettlementSumVO) => { code: 0, data: vo }
            setOrderFlow(res?.data?.data ?? res?.data ?? null);
        } catch {
            setOrderFlow(null);
        }
    }, [baseUrl]);

    const loadUserBalance = useCallback(async () => {
        try {
            const res = await getUserBalance({ baseUrl });
            setUserBalance(res?.data?.data ?? res?.data ?? null);
        } catch {
            setUserBalance(null);
        }
    }, [baseUrl]);

    useEffect(() => {
        if (baseUrl && authReady) {
            loadOrderList("unsettled");
            loadOrderFlow();
            loadUserBalance();
        }
    }, [baseUrl, authReady, loadOrderList, loadOrderFlow, loadUserBalance]);

    const handleOrderListTabChange = (tab) => {
        setOrderListTab(tab);
        loadOrderList(tab);
    };

    const handleSubmitOrder = async () => {
        const amount = parseFloat(betAmount);
        if (!Number.isFinite(amount) || amount <= 0 || betSlip.length === 0) {
            setSubmitError("请输入有效金额");
            return;
        }
        setSubmitError("");
        if (betSlip.length > 1 && hasDuplicateEventIdInSlip(betSlip)) {
            setSubmitError("串关不支持同一场比赛选择多个投注项");
            return;
        }
        setSubmitLoading(true);
        try {
            const refreshedSlip = betSlip.map((s) => refreshSlipItemFromCurrentOdds(s, matchRaw));
            const betOrderList = refreshedSlip.map((s) => {
                const order = { ...slipToBetOrder(s), betAmount: amount };
                if (s.type === "inplay" && (!order.bet365Id || !order.paId)) {
                    console.warn("[下单] 滚球单缺少 bet365Id 或 paId", { slipItem: s, order });
                }
                return order;
            });
            if (refreshedSlip.length === 1) {
                const res = await createOrder({
                    baseUrl,
                        betOrder: { ...betOrderList[0] },
                    isBestOdd: isBestOdd,
                });
                const code = res?.data?.code;
                const msg = res?.data?.msg ?? res?.data?.message;
                if (code != null && code !== 0) {
                    console.error("[下单失败] 单笔", res?.data, "请求体", betOrderList[0]);
                    throw new Error(msg || "下单失败");
                }
            } else {
                const res = await createContactOrder({
                    baseUrl,
                        betOrderList,
                    isBestOdd: isBestOdd,
                });
                const code = res?.data?.code;
                const msg = res?.data?.msg ?? res?.data?.message;
                if (code != null && code !== 0) {
                    console.error("[下单失败] 串关", res?.data, "请求体", betOrderList);
                    throw new Error(msg || "下单失败");
                }
            }
            setBetSlip([]);
            setConfirmStep(false);
            setBetAmount("");
            loadOrderList(orderListTab);
            loadOrderFlow();
            loadUserBalance();
        } catch (err) {
            const message = err?.message || "下单失败";
            setSubmitError(message);
            console.error("[下单] 异常", message, err);
        } finally {
            setSubmitLoading(false);
        }
    };

    useEffect(() => {
        if (betSlip.length === 0) return;
        setBetSlip((prev) => {
            const refreshed = prev.map((item) => refreshSlipItemFromCurrentOdds(item, matchRaw));
            const changed = refreshed.some((item, idx) => item !== prev[idx] && (
                item.selectionText !== prev[idx]?.selectionText ||
                item.odds !== prev[idx]?.odds ||
                item.handicap !== prev[idx]?.handicap ||
                item.at_time !== prev[idx]?.at_time ||
                item.timeStr !== prev[idx]?.timeStr ||
                item.teamType !== prev[idx]?.teamType
            ));
            return changed ? refreshed : prev;
        });
    }, [matchRaw, betSlip.length]);

    const parlayOdds = useMemo(() => {
        if (betSlip.length === 0) return 0;
        return betSlip.reduce((acc, s) => acc * (s.odds || 0), 1);
    }, [betSlip]);

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                flexDirection: "column",
                background: "#f5f7fb",
                padding: 12,
                color: "#111827",
                fontFamily:
                    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif',
            }}
        >
            {/* 顶部：标题 + 接口配置，不占满宽 */}
            <div style={{ flexShrink: 0, marginBottom: 12 }}>
                <div
                    style={{
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: "12px 16px",
                        marginBottom: 12,
                    }}
                >
                    <div style={{ fontSize: 18, fontWeight: 700 }}>足球早盘 / 比赛列表</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                        左侧联赛，右侧比赛列表。点击联赛后自动请求 bet365/all。
                    </div>
                    {userBalance && (
                        <div style={{ fontSize: 13, color: "#111827", marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
                            <span>余额: <strong>{userBalance.amount ?? 0}</strong></span>
                            {userBalance.walletBalance != null && <span>钱包余额: <strong>{userBalance.walletBalance}</strong></span>}
                            {userBalance.freezeAmount != null && <span>冻结: <strong>{userBalance.freezeAmount}</strong></span>}
                        </div>
                    )}
                </div>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1.6fr 0.7fr 0.7fr auto",
                        gap: 12,
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                    }}
                >
                    <div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Base URL</div>
                        <input
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            style={{
                                width: "100%",
                                height: 40,
                                borderRadius: 10,
                                border: "1px solid #d1d5db",
                                padding: "0 12px",
                                outline: "none",
                            }}
                        />
                    </div>


                    <div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>运动类型</div>
                        <select
                            value={sportId}
                            onChange={(e) => setSportId(Number(e.target.value))}
                            style={{
                                width: "100%",
                                height: 40,
                                borderRadius: 10,
                                border: "1px solid #d1d5db",
                                padding: "0 12px",
                                outline: "none",
                            }}
                        >
                            <option value={1}>1 - 足球</option>
                            <option value={18}>18 - 篮球</option>
                        </select>
                    </div>

                    <div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>type</div>
                        <select
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            style={{
                                width: "100%",
                                height: 40,
                                borderRadius: 10,
                                border: "1px solid #d1d5db",
                                padding: "0 12px",
                                outline: "none",
                            }}
                        >
                            <option value="0">0 - 早盘</option>
                            <option value="1">1 - 滚球</option>
                        </select>
                    </div>

                    <div style={{ display: "flex", alignItems: "end", gap: 10 }}>
                        <button
                            onClick={loadLeagues}
                            style={{
                                height: 40,
                                padding: "0 18px",
                                border: "none",
                                borderRadius: 10,
                                background: "#111827",
                                color: "#fff",
                                cursor: "pointer",
                                fontWeight: 600,
                            }}
                        >
                            {leagueLoading ? "加载中..." : "刷新联赛"}
                        </button>
                        <button
                            onClick={loadUserBalance}
                            style={{
                                height: 40,
                                padding: "0 18px",
                                border: "1px solid #d1d5db",
                                borderRadius: 10,
                                background: "#fff",
                                color: "#111827",
                                cursor: "pointer",
                                fontWeight: 600,
                            }}
                        >
                            刷新余额
                        </button>
                    </div>
                </div>
            </div>

                {error ? (
                    <div
                        style={{
                            marginBottom: 16,
                            background: "#fef2f2",
                            border: "1px solid #fecaca",
                            color: "#dc2626",
                            padding: 12,
                            borderRadius: 12,
                        }}
                    >
                        {error}
                    </div>
                ) : null}

                {/* 联赛 + 比赛列表 + 右侧投注单：按内容高度自动扩容，无内部滚动条 */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "280px 1fr 320px",
                        gap: 12,
                        alignItems: "start",
                    }}
                >
                    <div
                        style={{
                            background: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 12,
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                padding: "12px 14px",
                                borderBottom: "1px solid #e5e7eb",
                            }}
                        >
                            <div style={{ fontWeight: 700, fontSize: 15 }}>联赛列表</div>
                            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                共 {leagueList.length} 条
                            </div>
                        </div>

                        <div style={{ padding: 10 }}>
                            {leagueList.length === 0 ? (
                                <div
                                    style={{
                                        border: "1px dashed #d1d5db",
                                        borderRadius: 12,
                                        padding: 16,
                                        color: "#6b7280",
                                        fontSize: 13,
                                    }}
                                >
                                    暂无联赛数据
                                </div>
                            ) : (
                                leagueList.map((league) => {
                                    const active = selectedLeague?.leagueId === league.leagueId;
                                    return (
                                        <div
                                            key={league.leagueId}
                                            onClick={() => setSelectedLeague(league)}
                                            style={{
                                                marginBottom: 8,
                                                padding: "10px 12px",
                                                borderRadius: 10,
                                                cursor: "pointer",
                                                border: active ? "1px solid #111827" : "1px solid #e5e7eb",
                                                background: active ? "#111827" : "#fff",
                                                color: active ? "#fff" : "#111827",
                                                transition: "all 0.2s ease",
                                            }}
                                        >
                                            <div style={{ fontWeight: 600, lineHeight: 1.35, fontSize: 14 }}>{league.leagueName}</div>
                                            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>
                                                leagueId: {league.leagueId}
                                            </div>
                                            <div style={{ fontSize: 11, marginTop: 2, opacity: 0.85 }}>
                                                sportId: {league.sportId} / type: {league.type}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    <div>
                        <div
                            style={{
                                background: "#fff",
                                border: "1px solid #e5e7eb",
                                borderRadius: 12,
                                overflow: "hidden",
                            }}
                        >
                            <div
                                style={{
                                    padding: "12px 14px",
                                    borderBottom: "1px solid #e5e7eb",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 15 }}>比赛列表</div>
                                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                        {selectedLeague
                                            ? `${selectedLeague.leagueName}（${selectedLeague.leagueId}）`
                                            : "请选择联赛"}
                                        {type === "1" && (
                                            <span style={{ marginLeft: 8, color: wsConnected ? "#059669" : "#9ca3af" }}>
                                                · 赔率 WS: {wsConnected ? "已连接" : "连接中…"}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {selectedLeague ? (
                                    <button
                                        onClick={() => loadMatchesByLeague(selectedLeague)}
                                        style={{
                                            height: 34,
                                            padding: "0 12px",
                                            border: "1px solid #d1d5db",
                                            borderRadius: 8,
                                            background: "#fff",
                                            cursor: "pointer",
                                            fontSize: 13,
                                        }}
                                    >
                                        {matchLoading ? "刷新中..." : "刷新比赛"}
                                    </button>
                                ) : null}
                            </div>

                            {/* 日期 Tab：仅早盘时显示，滚球时不显示 */}
                            {type !== "1" && (
                            <div
                                style={{
                                    borderBottom: "1px solid #e5e7eb",
                                    padding: "10px 14px",
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 8,
                                    flexShrink: 0,
                                }}
                            >
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((dayIndex) => {
                                    const active = selectedDayIndex === dayIndex;
                                    return (
                                        <button
                                            key={dayIndex}
                                            type="button"
                                            onClick={() => setSelectedDayIndex(dayIndex)}
                                            style={{
                                                padding: "8px 14px",
                                                borderRadius: 10,
                                                border: active ? "1px solid #111827" : "1px solid #e5e7eb",
                                                background: active ? "#111827" : "#fff",
                                                color: active ? "#fff" : "#111827",
                                                fontSize: 13,
                                                fontWeight: 500,
                                                cursor: "pointer",
                                            }}
                                        >
                                            {getDateTabLabel(dayIndex)}
                                        </button>
                                    );
                                })}
                            </div>
                            )}

                            <div style={{ padding: 12 }}>
                                {matchLoading ? (
                                    <div
                                        style={{
                                            border: "1px dashed #d1d5db",
                                            borderRadius: 12,
                                            padding: 28,
                                            textAlign: "center",
                                            color: "#6b7280",
                                        }}
                                    >
                                        比赛列表加载中...
                                    </div>
                                ) : matchList.length > 0 ? (
                                    matchList.map((match, index) => (
                                        <div
                                            key={getMatchKey(match, index)}
                                            style={{
                                                border: "1px solid #e5e7eb",
                                                borderRadius: 10,
                                                padding: 12,
                                                marginBottom: 10,
                                                background: "#fff",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    marginBottom: 8,
                                                    paddingBottom: 8,
                                                    borderBottom: "1px solid #e5e7eb",
                                                }}
                                            >
                                                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>
                                                        {getHomeName(match)} VS {getAwayName(match)}
                                                    </div>
                                                    {match?.timeStatus === "1" && (
                                                        <span
                                                            style={{
                                                                fontSize: 11,
                                                                fontWeight: 600,
                                                                color: "#dc2626",
                                                                background: "#fef2f2",
                                                                padding: "2px 8px",
                                                                borderRadius: 6,
                                                            }}
                                                        >
                                                            滚球
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                                    {match?.timeStatus === "1" && getLiveClockDisplay(match, clockTick) && (
                                                        <span style={{ fontSize: 12, color: "#0369a1", fontWeight: 600 }}>
                                                            {getLiveClockDisplay(match, clockTick)}
                                                        </span>
                                                    )}
                                                    {(match?.timeStatus === "1" || match?.ballScore) && getScore(match) !== "-" && (
                                                        <span style={{ fontSize: 15, color: "#059669", fontWeight: 700 }}>
                                                            {getScore(match)}
                                                        </span>
                                                    )}
                                                    <span style={{ fontSize: 12, color: "#6b7280" }}>
                                                        {getMatchTime(match)}
                                                    </span>
                                                </div>
                                            </div>

                                            {match?.timeStatus === "1" && Array.isArray(match?.treeResults) && match.treeResults.length > 0 ? (
                                                <div
                                                    style={{
                                                        display: "grid",
                                                        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                                                        gap: 12,
                                                    }}
                                                >
                                                    {match.treeResults.filter(isMavoDisplayable).map((mavo, idx) => (
                                                        <RollingMarketCell
                                                            key={mavo.id || mavo.ID || idx}
                                                            mavo={mavo}
                                                            match={match}
                                                            onAddSlip={addToSlip}
                                                            highlight={highlight}
                                                        />
                                                    ))}
                                                </div>
                                            ) : (
                                            <div
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                                                    gap: 12,
                                                }}
                                            >
                                                {MAIN_MARKET_KEYS.map(({ key: mk, label }) => {
                                                    const oddsObj = match?.odds?.[mk];
                                                    return (
                                                        <MarketOddsCell
                                                            key={mk}
                                                            marketKey={mk}
                                                            label={label}
                                                            oddsObj={oddsObj}
                                                            match={match}
                                                            onAddSlip={addToSlip}
                                                        />
                                                    );
                                                })}
                                            </div>
                                            )}

                                            {match?.id != null && (
                                                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6 }}>
                                                    ID: {match.id}
                                                    {match.bet365Id != null && ` · bet365: ${match.bet365Id}`}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <div
                                        style={{
                                            border: "1px dashed #d1d5db",
                                            borderRadius: 12,
                                            padding: 28,
                                            textAlign: "center",
                                            color: "#6b7280",
                                        }}
                                    >
                                        暂无比赛数据
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 右侧：投注单 + 确认 */}
                    <div
                        style={{
                            background: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 12,
                            overflow: "hidden",
                        }}
                    >
                        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", fontWeight: 700, fontSize: 15 }}>
                            投注单
                        </div>
                        {!confirmStep ? (
                            <>
                                <div style={{ padding: 10 }}>
                                    {betSlip.length === 0 ? (
                                        <div style={{ color: "#9ca3af", fontSize: 13 }}>点击左侧赔率加入</div>
                                    ) : (
                                        betSlip.map((item) => (
                                            <div
                                                key={item.key}
                                                style={{
                                                    marginBottom: 8,
                                                    padding: 8,
                                                    background: "#f9fafb",
                                                    borderRadius: 8,
                                                    fontSize: 12,
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "flex-start",
                                                    gap: 6,
                                                }}
                                            >
                                                <span style={{ flex: 1, wordBreak: "break-word" }}>{item.selectionText}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removeFromSlip(item.key)}
                                                    style={{ flexShrink: 0, padding: "2px 6px", fontSize: 11, cursor: "pointer", border: "1px solid #e5e7eb", borderRadius: 4 }}
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                                {betSlip.length > 0 && (
                                    <div style={{ padding: 12, borderTop: "1px solid #e5e7eb" }}>
                                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                                            共 {betSlip.length} 项 {betSlip.length > 1 ? ` · 串关赔率 ${parlayOdds.toFixed(2)}` : ` · 赔率 ${betSlip[0]?.odds}`}
                                        </div>
                                        <div style={{ marginBottom: 8 }}>
                                            <label style={{ fontSize: 12, marginRight: 8 }}>
                                                <input type="checkbox" checked={isBestOdd} onChange={(e) => setIsBestOdd(e.target.checked)} /> 接受更优赔率
                                            </label>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmStep(true)}
                                            style={{
                                                width: "100%",
                                                padding: "10px 16px",
                                                background: "#111827",
                                                color: "#fff",
                                                border: "none",
                                                borderRadius: 8,
                                                fontWeight: 600,
                                                cursor: "pointer",
                                            }}
                                        >
                                            确认投注
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ padding: 12 }}>
                                <div style={{ fontSize: 13, marginBottom: 10 }}>请确认投注内容并输入金额</div>
                                {betSlip.map((item) => (
                                    <div key={item.key} style={{ marginBottom: 6, fontSize: 12, color: "#374151" }}>
                                        {item.selectionText}
                                    </div>
                                ))}
                                <div style={{ marginTop: 12, marginBottom: 8 }}>
                                    <label style={{ fontSize: 12 }}>投注金额</label>
                                    <input
                                        type="number"
                                        min="1"
                                        step="0.01"
                                        value={betAmount}
                                        onChange={(e) => setBetAmount(e.target.value)}
                                        placeholder="请输入金额"
                                        style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
                                    />
                                </div>
                                {submitError && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{submitError}</div>}
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                        type="button"
                                        onClick={() => { setConfirmStep(false); setSubmitError(""); }}
                                        disabled={submitLoading}
                                        style={{ flex: 1, padding: "10px", border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", cursor: "pointer" }}
                                    >
                                        返回
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSubmitOrder}
                                        disabled={submitLoading}
                                        style={{ flex: 1, padding: "10px", background: "#111827", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}
                                    >
                                        {submitLoading ? "提交中..." : "提交"}
                                    </button>
                                </div>
                            </div>
                        )}
                        {/* 滚球时：WS 赔率推送控制台 */}
                        {type === "1" && (
                            <div style={{ borderTop: "1px solid #e5e7eb", padding: 10, background: "#f9fafb", maxHeight: 320, overflow: "auto" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                                    <span style={{ fontWeight: 600, fontSize: 13, color: "#374151" }}>WS 推送</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <label style={{ fontSize: 12, color: "#6b7280" }}>
                                            topic
                                            <select
                                                value={wsConsoleFilterTopic}
                                                onChange={(e) => setWsConsoleFilterTopic(e.target.value)}
                                                style={{ marginLeft: 4, padding: "4px 8px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 6 }}
                                            >
                                                <option value="">全部</option>
                                                <option value="in_play_odds_update">in_play_odds_update</option>
                                                <option value="inplay_league">inplay_league</option>
                                                <option value="league">league</option>
                                            </select>
                                        </label>
                                        <label style={{ fontSize: 12, color: "#6b7280" }}>
                                            eventId
                                            <input
                                                type="text"
                                                value={wsConsoleFilterEventId}
                                                onChange={(e) => setWsConsoleFilterEventId(e.target.value)}
                                                placeholder="筛滚球赔率"
                                                style={{ marginLeft: 4, padding: "4px 8px", fontSize: 12, width: 100, border: "1px solid #d1d5db", borderRadius: 6 }}
                                            />
                                        </label>
                                        <label style={{ fontSize: 12, color: "#6b7280" }}>
                                            maId
                                            <input
                                                type="text"
                                                value={wsConsoleFilterMaId}
                                                onChange={(e) => setWsConsoleFilterMaId(e.target.value)}
                                                placeholder="筛玩法"
                                                style={{ marginLeft: 4, padding: "4px 8px", fontSize: 12, width: 88, border: "1px solid #d1d5db", borderRadius: 6 }}
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setWsOddsConsoleLog([])}
                                            style={{ padding: "4px 10px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer", color: "#6b7280" }}
                                        >
                                            清除
                                        </button>
                                    </div>
                                </div>
                                {(() => {
                                    const topicOk = (entry) => !wsConsoleFilterTopic || entry.type === wsConsoleFilterTopic;
                                    const eventIdOk = (entry) => {
                                        if (!wsConsoleFilterEventId.trim()) return true;
                                        const id = entry.eventId != null ? String(entry.eventId) : "";
                                        return id.includes(wsConsoleFilterEventId.trim());
                                    };
                                    const maIdOk = (entry) => {
                                        if (!wsConsoleFilterMaId.trim()) return true;
                                        const id = entry.maId != null ? String(entry.maId) : "";
                                        return id.includes(wsConsoleFilterMaId.trim());
                                    };
                                    const filtered = wsOddsConsoleLog.filter((e) => topicOk(e) && eventIdOk(e) && maIdOk(e));
                                    return filtered.length === 0 ? (
                                        <div style={{ fontSize: 12, color: "#9ca3af" }}>
                                            {wsOddsConsoleLog.length === 0 ? "暂无推送记录，连接后收到推送会在此显示" : "无符合筛选条件的记录"}
                                        </div>
                                    ) : (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                            {filtered.map((entry) => (
                                            <div
                                                key={entry.id}
                                                style={{
                                                    fontSize: 11,
                                                    padding: 8,
                                                    background: "#fff",
                                                    border: "1px solid #e5e7eb",
                                                    borderRadius: 6,
                                                    fontFamily: "monospace",
                                                }}
                                            >
                                                {entry.type === "inplay_league" ? (
                                                    <>
                                                        <div style={{ marginBottom: 4, color: "#6b7280" }}>[{entry.ts}] 滚球联赛列表</div>
                                                        <div style={{ color: "#059669", marginBottom: 4 }}>推送 {entry.count ?? 0} 个联赛</div>
                                                        {entry.detail && (
                                                            <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 4, paddingTop: 4, borderTop: "1px solid #e5e7eb" }}>
                                                                {entry.detail.leagueIds?.length !== undefined && entry.detail.leagueIds.length > 0 && `leagueIds: ${JSON.stringify(entry.detail.leagueIds)}\n`}
                                                                {entry.detail.payloadKeys?.length ? `payloadKeys: ${entry.detail.payloadKeys.join(", ")}\n` : null}
                                                                {entry.detail.payloadSample ? `payloadSample: ${entry.detail.payloadSample}\n` : null}
                                                                {entry.detail.afterRefetch && `已请求 API 刷新，联赛数: ${entry.detail.apiCount ?? entry.count}\n`}
                                                                {entry.detail.refetchError && `API 刷新失败: ${entry.detail.refetchError}`}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : entry.type === "league" ? (
                                                    <>
                                                        <div style={{ marginBottom: 4, color: "#6b7280" }}>[{entry.ts}] 联赛赛事列表</div>
                                                        <div style={{ color: "#059669", marginBottom: 4 }}>leagueId={entry.leagueId} 推送 {entry.matchCount ?? 0} 场</div>
                                                        {entry.detail && (
                                                            <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 4, paddingTop: 4, borderTop: "1px solid #e5e7eb" }}>
                                                                {entry.detail.isSelectedLeague !== undefined && `当前选中联赛: ${entry.detail.isSelectedLeague}\n`}
                                                                {entry.detail.inPlayGroups !== undefined && `inPlay 组数: ${entry.detail.inPlayGroups}\n`}
                                                                {entry.detail.eventIds?.length !== undefined && `eventIds: ${JSON.stringify(entry.detail.eventIds)}\n`}
                                                                {entry.detail.payloadKeys?.length ? `payloadKeys: ${entry.detail.payloadKeys.join(", ")}\n` : null}
                                                                {entry.detail.payloadSample ? `payloadSample: ${entry.detail.payloadSample}\n` : null}
                                                                {entry.detail.afterRefetch && `已请求 API 刷新，赛事数: ${entry.detail.apiMatchCount ?? entry.matchCount}\n`}
                                                                {entry.detail.refetchError && `API 刷新失败: ${entry.detail.refetchError}`}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        <div style={{ marginBottom: 4, color: "#6b7280" }}>
                                                            [{entry.ts}] eventId={entry.eventId} maId={entry.maId} {entry.maName}
                                                        </div>
                                                        <div style={{ marginBottom: 4, wordBreak: "break-all" }}>{entry.summary}</div>
                                                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                                                            <span style={{ color: entry.oddsUnchanged ? "#059669" : "#d97706", fontWeight: 600 }}>
                                                                {entry.oddsUnchanged ? "与之前一致" : "有变化"}
                                                                {(entry.changedPaIds?.length ?? 0) > 0 && ` (${entry.changedPaIds.length} 项)`}
                                                            </span>
                                                            <span style={{ color: entry.mergeSuccess ? "#059669" : "#dc2626" }}>
                                                                {entry.mergeSuccess ? "修改成功" : "修改失败"}
                                                            </span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>

                {/* 下方：订单列表 + 结算汇总 */}
                <div style={{ flexShrink: 0, marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 700, fontSize: 15 }}>订单列表</span>
                                <span style={{ display: "flex", gap: 0, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                                    <button
                                        type="button"
                                        onClick={() => handleOrderListTabChange("unsettled")}
                                        style={{
                                            padding: "6px 12px",
                                            fontSize: 13,
                                            border: "none",
                                            background: orderListTab === "unsettled" ? "#111827" : "#fff",
                                            color: orderListTab === "unsettled" ? "#fff" : "#374151",
                                            cursor: "pointer",
                                        }}
                                    >
                                        未结算
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleOrderListTabChange("other")}
                                        style={{
                                            padding: "6px 12px",
                                            fontSize: 13,
                                            border: "none",
                                            borderLeft: "1px solid #e5e7eb",
                                            background: orderListTab === "other" ? "#111827" : "#fff",
                                            color: orderListTab === "other" ? "#fff" : "#374151",
                                            cursor: "pointer",
                                        }}
                                    >
                                        其他（结算失败/已结算）
                                    </button>
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={loadOrderListCurrentTab}
                                disabled={orderListLoading}
                                style={{ padding: "6px 12px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", cursor: "pointer" }}
                            >
                                {orderListLoading ? "加载中..." : "刷新"}
                            </button>
                        </div>
                        <div style={{ padding: 12 }}>
                            {orderListLoading && orderList.length === 0 ? (
                                <div style={{ color: "#9ca3af", textAlign: "center", padding: 24 }}>加载中...</div>
                            ) : orderList.length === 0 ? (
                                <div style={{ color: "#9ca3af", textAlign: "center", padding: 24 }}>
                                    {orderListTab === "unsettled" ? "暂无未结算订单" : "暂无其他状态订单"}
                                </div>
                            ) : (
                                orderList.map((order) => (
                                    <div
                                        key={order.orderId || order.createdTime}
                                        style={{
                                            border: "1px solid #e5e7eb",
                                            borderRadius: 8,
                                            padding: 10,
                                            marginBottom: 8,
                                            fontSize: 12,
                                        }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                            <span>订单号: {order.orderId || order.contact || "-"}</span>
                                            <span>
                                                金额: {order.betAmount} · 结算: {order.settlementAmount != null ? order.settlementAmount : "-"}
                                                {order.settlementStatus != null && (
                                                    <span style={{ marginLeft: 8, color: order.settlementStatus === "HAS_BEEN_SETTLED" ? "#059669" : order.settlementStatus === "SETTLEMENT_FAIL" ? "#dc2626" : "#6b7280", fontSize: 11 }}>
                                                        {order.settlementStatus === "HAS_BEEN_SETTLED" ? "已结算" : order.settlementStatus === "SETTLEMENT_FAIL" ? "结算失败" : order.settlementStatus}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                        {order.contactVO && order.contactVO.length > 0 ? (
                                            order.contactVO.map((c, i) => (
                                                (() => {
                                                    const selectionText = c.teamType || c.handicap || "";
                                                    return (
                                                <div key={i} style={{ color: "#6b7280", marginTop: 4 }}>
                                                    {c.event?.homeNameCN} vs {c.event?.awayNameCN} {(c.betPlayName || "").replace(/_/g, " ")}{selectionText ? ` ${selectionText}` : ""} @{c.odds}
                                                    {c.whenTheScore ? <span style={{ color: "#dc2626" }}> · 当时比分: {c.whenTheScore}</span> : null}
                                                </div>
                                                    );
                                                })()
                                            ))
                                        ) : (
                                            <div style={{ color: "#6b7280" }}>
                                                单笔
                                                {(order.betPlayName || "").replace(/_/g, " ")}{(order.teamType || order.handicap || "") ? ` ${order.teamType || order.handicap || ""}` : ""}
                                                {order.whenTheScore ? <span style={{ color: "#dc2626" }}> · 当时比分: {order.whenTheScore}</span> : null}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                    {orderFlow && (
                        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
                            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>结算汇总</div>
                            <div style={{ fontSize: 13, display: "flex", gap: 24, flexWrap: "wrap" }}>
                                <span>总投注: {orderFlow.sumBetsAmount != null ? orderFlow.sumBetsAmount : "-"}</span>
                                <span>总结算: {orderFlow.sumSettlementAmount != null ? orderFlow.sumSettlementAmount : "-"}</span>
                                <span>有效金额: {orderFlow.sumEffectiveAmount != null ? orderFlow.sumEffectiveAmount : "-"}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
    );
}
