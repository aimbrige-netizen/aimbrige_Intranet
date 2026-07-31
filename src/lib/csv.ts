/**
 * CSV 내보내기.
 *
 * AttendanceView 안에 60줄로 인라인돼 있던 걸 꺼냈다.
 * 내보내기가 근태에만 있고 다른 목록에는 없던 이유가 이것 — 재사용할 수가 없었다.
 *
 * 외부 라이브러리를 쓰지 않는다. 필요한 건 따옴표 이스케이프와 BOM뿐이다.
 */

/** Excel이 UTF-8로 인식하도록 BOM을 붙인다. 없으면 한글이 깨진다 */
const BOM = "﻿";

export function toCsv(header: string[], rows: (string | number | null)[][]) {
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\r\n");
}

export function downloadCsv(
  filename: string,
  header: string[],
  rows: (string | number | null)[][],
) {
  const blob = new Blob([BOM + toCsv(header, rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
