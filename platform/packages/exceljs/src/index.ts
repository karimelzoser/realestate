import { readSheet } from 'read-excel-file/universal';

export type CellValue = string | number | boolean | Date | null;

export class Cell {
  constructor(public readonly value: CellValue) {}
}

export class Row {
  constructor(private readonly values: readonly CellValue[]) {}

  eachCell(
    _options: { includeEmpty?: boolean },
    callback: (cell: Cell, columnNumber: number) => void,
  ): void {
    for (let index = 0; index < this.values.length; index += 1) {
      callback(new Cell(this.values[index] ?? null), index + 1);
    }
  }

  getCell(columnNumber: number): Cell {
    return new Cell(this.values[columnNumber - 1] ?? null);
  }
}

export class Worksheet {
  readonly rowCount: number;

  constructor(private readonly rows: readonly (readonly CellValue[])[]) {
    this.rowCount = rows.length;
  }

  getRow(rowNumber: number): Row {
    return new Row(this.rows[rowNumber - 1] ?? []);
  }
}

export class Workbook {
  readonly worksheets: Worksheet[] = [];

  readonly xlsx = {
    load: async (buffer: ArrayBuffer): Promise<Workbook> => {
      const parsed = await readSheet(buffer);
      this.worksheets.splice(
        0,
        this.worksheets.length,
        new Worksheet(parsed as readonly (readonly CellValue[])[]),
      );
      return this;
    },
  };
}
