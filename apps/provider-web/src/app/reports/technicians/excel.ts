export interface ExcelColumn {
  key: string;
  header: string;
  width?: number;
}

// Builds a real .xlsx (not a CSV-renamed-to-.xlsx) from already-loaded report
// rows and triggers a browser download. Exports whatever is currently on
// screen, so it respects the active period/technician filter.
export async function exportRowsToExcel(
  rows: Record<string, unknown>[],
  columns: ExcelColumn[],
  filename: string,
  sheetName = "Report"
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
