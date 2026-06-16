function normalizeMavoFromWs(mavo) {
  if (!mavo || typeof mavo !== 'object') return mavo;
  const mavoKeys = { ID: 'id', NA: 'na', iD: 'id', nA: 'na', CN: 'cn', DO: 'do', FI: 'fi', IT: 'it', SU: 'su', SS: 'ss', TM: 'tm', TS: 'ts', TU: 'tu', TT: 'tt', CP: 'cp' };
  const covoKeys = { CN: 'cn', NA: 'na', cN: 'cn', nA: 'na' };
  const pavoKeys = { ID: 'id', NA: 'na', OD: 'od', nA: 'na', oD: 'od', HA: 'ha', FI: 'fi', IT: 'it', N2: 'n2', SU: 'su', HD: 'hd', BS: 'bs' };

  function addLowerAliases(obj, keyMap) {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(keyMap).forEach((upper) => {
      if (obj[upper] !== undefined && obj[keyMap[upper]] === undefined) {
        obj[keyMap[upper]] = obj[upper];
      }
    });
  }

  function normalizePa(pa) {
    if (!pa || typeof pa !== 'object') return;
    addLowerAliases(pa, pavoKeys);
  }

  function normalizeCo(co) {
    if (!co || typeof co !== 'object') return;
    addLowerAliases(co, covoKeys);
    if (Array.isArray(co.pa)) co.pa.forEach(normalizePa);
  }

  addLowerAliases(mavo, mavoKeys);
  if (Array.isArray(mavo.co)) mavo.co.forEach(normalizeCo);
  return mavo;
}

function applyClockAnchorFromPush(match, push) {
  if (!match || !push) return match;
  const incomingSignature = push.clockBaseSignature != null && push.clockBaseSignature !== '' ? String(push.clockBaseSignature) : '';
  const existingSignature = match.clockBaseSignature != null && match.clockBaseSignature !== '' ? String(match.clockBaseSignature) : '';
  if (!incomingSignature) return match;
  if (incomingSignature === existingSignature) return match;
  const anchor = {};
  ['clockBaseTM', 'clockBaseTS', 'clockBaseCP', 'clockBaseTT', 'clockBaseReceivedAt', 'clockBaseElapsedSeconds', 'clockEstimatedElapsedSeconds', 'clockBaseSignature'].forEach((key) => {
    if (push[key] != null && push[key] !== '') {
      anchor[key] = push[key];
    }
  });
  if (Object.keys(anchor).length === 0) return match;
  return { ...match, ...anchor, liveClockSource: 'anchor' };
}

function mergeMavoPaIntoExisting(existingMavo, pushMavo) {
  if (!existingMavo || !pushMavo) return existingMavo;
  const existingCo = Array.isArray(existingMavo.co) ? existingMavo.co : [];
  const pushCo = Array.isArray(pushMavo.co) ? pushMavo.co : [];
  if (pushCo.length === 0) return existingMavo;

  const newCo = existingCo.map((existingC, coIndex) => {
    const existingPa = Array.isArray(existingC.pa) ? existingC.pa : [];
    const pushC = pushCo[coIndex] || pushCo[0];
    const pushPaList = Array.isArray(pushC?.pa) ? pushC.pa : [];
    const paById = new Map();
    pushPaList.forEach((p) => {
      const pid = p?.id ?? p?.ID;
      if (pid != null) paById.set(String(pid), p);
    });
    const newPa = existingPa.map((oldPa) => {
      const paId = oldPa?.id ?? oldPa?.ID;
      const pushed = paId != null ? paById.get(String(paId)) : null;
      if (!pushed) return oldPa;
      return {
        ...oldPa,
        od: pushed.od ?? pushed.OD ?? oldPa.od ?? oldPa.OD,
        OD: pushed.OD ?? pushed.od ?? oldPa.OD ?? oldPa.od,
        ha: pushed.ha ?? pushed.HA ?? oldPa.ha ?? oldPa.HA,
        HA: pushed.HA ?? pushed.ha ?? oldPa.HA ?? oldPa.ha,
        na: pushed.na ?? pushed.NA ?? oldPa.na ?? oldPa.NA,
        NA: pushed.NA ?? pushed.na ?? oldPa.NA ?? oldPa.na,
      };
    });
    const addedPaIds = new Set(existingPa.map((p) => String(p?.id ?? p?.ID ?? '')));
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
      const matchId = match?.id != null ? String(match.id) : match?.bet365Id != null ? String(match.bet365Id) : null;
      if (matchId !== eventId) return match;
      const tree = Array.isArray(match.treeResults) ? match.treeResults.slice() : [];
      const maIdStr = mavo.id != null ? String(mavo.id) : mavo.ID != null ? String(mavo.ID) : null;
      const idx = maIdStr == null ? -1 : tree.findIndex((item) => (item?.id != null ? String(item.id) : item?.ID != null ? String(item.ID) : null) === maIdStr);
      if (idx >= 0) {
        tree[idx] = mergeMavoPaIntoExisting(tree[idx], mavo);
      } else {
        tree.push(mavo);
      }
      return applyClockAnchorFromPush({ ...match, treeResults: tree }, mavo);
    });
    return { ...group, value: newValue };
  });

  const newData = { ...data, inPlay: newInPlay };
  if (prevRaw.data?.data) return { ...prevRaw, data: { ...prevRaw.data, data: newData } };
  if (prevRaw.data) return { ...prevRaw, data: { ...prevRaw.data, ...newData } };
  return { ...prevRaw, ...newData };
}

function applyEventResultSnapshot(prevRaw, snapshot) {
  if (!prevRaw || !snapshot) return prevRaw;
  const list = Array.isArray(snapshot) ? snapshot : (snapshot.events && Array.isArray(snapshot.events) ? snapshot.events : [snapshot]);
  const data = prevRaw?.data?.data ?? prevRaw?.data ?? prevRaw;
  const inPlay = data?.inPlay;
  if (!Array.isArray(inPlay)) return prevRaw;

  let updated = false;
  const newInPlay = inPlay.map((group) => {
    const value = group?.value;
    if (!Array.isArray(value)) return group;
    const newValue = value.map((match) => {
      const matchId = match?.id != null ? String(match.id) : match?.bet365Id != null ? String(match.bet365Id) : null;
      const item = list.find((entry) => {
        const eventIdStr = entry?.eventId != null ? String(entry.eventId) : entry?.bet365Id != null ? String(entry.bet365Id) : null;
        return eventIdStr === matchId;
      });
      if (!item) return match;

      updated = true;
      const next = applyClockAnchorFromPush({ ...match }, item);
      const timeStatus = item?.timeStatus != null ? String(item.timeStatus) : null;
      const minute = item?.tm != null ? Number(item.tm) : null;
      const second = item?.ts != null ? Number(item.ts) : null;
      const scoreStr = item?.ss != null ? String(item.ss) : (item?.ballScore != null ? String(item.ballScore) : null);
      const elapsedSecondsRaw = item?.clockEstimatedElapsedSeconds ?? next?.clockEstimatedElapsedSeconds;
      const elapsedSeconds = Number(elapsedSecondsRaw);
      const liveHalf = Number.isFinite(elapsedSeconds)
        ? (elapsedSeconds < 45 * 60 ? 1 : 2)
        : (minute != null ? (minute <= 45 ? 1 : 2) : null);

      if (timeStatus != null) next.timeStatus = timeStatus;
      if (minute != null || second != null) {
        next.liveClockMinute = minute != null ? Math.max(0, minute) : (next.liveClockMinute ?? 0);
        next.liveClockSecond = second != null ? Math.max(0, Math.min(59, second)) : (next.liveClockSecond ?? 0);
        next.liveClockUpdatedAt = Date.now();
        next.liveHalf = liveHalf != null ? liveHalf : next.liveHalf;
      }
      if (scoreStr != null) next.ballScore = scoreStr;
      return next;
    });
    return { ...group, value: newValue };
  });

  if (!updated) return prevRaw;
  const newData = { ...data, inPlay: newInPlay };
  if (prevRaw.data?.data) return { ...prevRaw, data: { ...prevRaw.data, data: newData } };
  if (prevRaw.data) return { ...prevRaw, data: { ...prevRaw.data, ...newData } };
  return { ...prevRaw, ...newData };
}

export {
  applyEventResultSnapshot,
  mergeMavoIntoMatchRaw,
  normalizeMavoFromWs,
};
