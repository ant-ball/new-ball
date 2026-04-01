import { getStoredBallToken } from "./auth";

const DEFAULT_BASE_URL = "https://ball.skybit.shop";

function normalizeDayParam(day) {
    if (day == null || day === "") return undefined;
    if (typeof day === "number" && !Number.isNaN(day)) return day;
    if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    const d = typeof day === "string" && /^\d+$/.test(day) ? new Date(day.length <= 10 ? Number(day) * 1000 : Number(day)) : new Date(day);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.getTime();
}

function buildQuery(params = {}) {
    const search = new URLSearchParams();
    Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value !== undefined && value !== null && value !== "") {
            search.append(key, value);
        }
    });
    return search.toString();
}

function buildAuthHeaders(extra = {}) {
    const token = getStoredBallToken();
    return {
        ...(token ? { Authorization: token } : {}),
        ...extra,
    };
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: "omit",
        headers: buildAuthHeaders(options.headers || {}),
    });
    const json = await response.json();
    return { response, json };
}

export async function getLeagueGroup({
    baseUrl = DEFAULT_BASE_URL,
    type = 0,
    sportId = 1,
    day,
    daysOfTime = 1,
} = {}) {
    const query = buildQuery({
        type,
        sportId,
        sport_id: sportId,
        day: normalizeDayParam(day),
        daysOfTime,
    });
    const url = `${baseUrl}/soccer/event/league-group?${query}`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`获取联赛列表失败，HTTP ${response.status}`);
    return { url, data: json };
}

export async function getAssociation({ baseUrl = DEFAULT_BASE_URL } = {}) {
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/soccer/event/association`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`association 失败 HTTP ${response.status}`);
    return { url, data: json };
}

export async function newOdds({ baseUrl = DEFAULT_BASE_URL, betOrderList = [], isBestOdd = false } = {}) {
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/soccer/event/new-odds`;
    const { response, json } = await requestJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betOrderList, isBestOdd }),
    });
    if (!response.ok) throw new Error(`new-odds 失败 HTTP ${response.status}`);
    return { url, data: json };
}

export async function createOrder({ baseUrl = DEFAULT_BASE_URL, betOrder, isBestOdd = false } = {}) {
    const params = new URLSearchParams();
    if (betOrder) {
        Object.entries(betOrder).forEach(([k, v]) => {
            if (v === undefined || v === null) return;
            params.append(k, String(v));
        });
        params.append("isBestOdd", isBestOdd ? "true" : "false");
    }
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/order/add`;
    const { json } = await requestJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });
    return { url, data: json };
}

export async function createContactOrder({ baseUrl = DEFAULT_BASE_URL, betOrderList = [], isBestOdd = false } = {}) {
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/order/contact/add`;
    const { json } = await requestJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betOrderList, isBestOdd }),
    });
    return { url, data: json };
}

export async function getOrderList({ baseUrl = DEFAULT_BASE_URL, type = 0, page = 1, size = 20, day } = {}) {
    const q = buildQuery({ type, page, size, day });
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/order/list?${q}`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`order/list 失败 HTTP ${response.status}`);
    return { url, data: json };
}

export async function getOrderFlow({ baseUrl = DEFAULT_BASE_URL } = {}) {
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/order/flow`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`order/flow 失败 HTTP ${response.status}`);
    return { url, data: json };
}

export async function getUserBalance({ baseUrl = DEFAULT_BASE_URL } = {}) {
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/user/balance`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`user/balance 失败 HTTP ${response.status}`);
    return { url, data: json };
}

export async function getUserBalanceBills({
    baseUrl = DEFAULT_BASE_URL,
    id,
    direction = "NEXT",
    limit = 10,
    coin,
    symbol,
    type,
    startTime,
    endTime,
} = {}) {
    const q = buildQuery({ id, direction, limit, coin, symbol, type, startTime, endTime });
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/user/balance/bills${q ? `?${q}` : ""}`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`balance/bills 失败 HTTP ${response.status}`);
    if (json && json.code != null && String(json.code) !== "0") {
        throw new Error(json.msg || "balance/bills 失败");
    }
    return { url, data: json };
}

export async function queryTransferWalletTypes({ baseUrl = DEFAULT_BASE_URL } = {}) {
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/user/transfer/types`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`transfer/types 失败 HTTP ${response.status}`);
    if (json && json.code != null && String(json.code) !== "0") {
        throw new Error(json.msg || "transfer/types 失败");
    }
    return { url, data: json };
}

export async function queryTransferWalletBalance({ baseUrl = DEFAULT_BASE_URL, walletType } = {}) {
    if (!walletType) throw new Error("walletType 不能为空");
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/user/transfer/balance?walletType=${encodeURIComponent(walletType)}`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`transfer/balance 失败 HTTP ${response.status}`);
    if (json && json.code != null && String(json.code) !== "0") {
        throw new Error(json.msg || "transfer/balance 失败");
    }
    return { url, data: json };
}

export async function submitTransfer({
    baseUrl = DEFAULT_BASE_URL,
    fromWalletType,
    toWalletType,
    coinType = "USDT",
    amount,
} = {}) {
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/user/transfer`;
    const { response, json } = await requestJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            fromWalletType,
            toWalletType,
            coinType,
            amount,
        }),
    });
    if (!response.ok) throw new Error(`transfer 失败 HTTP ${response.status}`);
    if (json && json.code != null && String(json.code) !== "0") {
        throw new Error(json.msg || "transfer 失败");
    }
    return { url, data: json };
}

export async function getBet365All({
    baseUrl = DEFAULT_BASE_URL,
    day,
    leagueIds,
    daysOfTime = 1,
    sportId = 1,
} = {}) {
    if (leagueIds == null || leagueIds === "") {
        throw new Error("leagueIds 不能为空");
    }
    const query = buildQuery({
        day: normalizeDayParam(day),
        leagueIds,
        daysOfTime,
        sportId,
        sport_id: sportId,
    });
    const url = `${baseUrl}/soccer/event/bet365/all?${query}`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`获取比赛列表失败，HTTP ${response.status}`);
    return { url, data: json };
}

export async function getMatchResult({ baseUrl = DEFAULT_BASE_URL, eventId } = {}) {
    if (!eventId) throw new Error("eventId 不能为空");
    const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/event/result/queryByBet365Id?bet365Id=${encodeURIComponent(eventId)}`;
    const { response, json } = await requestJson(url);
    if (!response.ok) throw new Error(`result 失败 HTTP ${response.status}`);
    return { url, data: json };
}
