export type FollowerDelta = { date: string; delta: number }

/** Reconstrói totais absolutos caminhando para trás a partir do total atual. */
export function reconstructFollowerTotals(
  points: Array<FollowerDelta>,
  currentFollowers: number,
) {
  const ascending = [...points].sort((left, right) =>
    left.date.localeCompare(right.date),
  )
  const totals: Array<{ date: string; followers: number }> = []
  let running = currentFollowers
  for (let index = ascending.length - 1; index >= 0; index--) {
    const point = ascending[index]
    if (running < 0) break
    totals.push({ date: point.date, followers: running })
    running -= point.delta
  }
  return totals.reverse()
}
