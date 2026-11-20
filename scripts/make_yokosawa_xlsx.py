"""ヨコサワ表（src/logic/yokosawa.ts）から Excel 版を作る。

  python3 scripts/make_yokosawa_xlsx.py   →  public/yokosawa-ranges.xlsx

各シートの D2 に手札（例: AKo, 65s, 77）を入れると、表の該当マスが青くなり、行・列の見出しも強調される。
D3 でポジションを選ぶと、参加基準と「参加できるか」が表示される。
"""
import re
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "src/logic/yokosawa.ts").read_text(encoding="utf-8")
RANKS = "AKQJT98765432"


def block(name: str) -> str:
    start = SRC.index(f"const {name}")
    depth = 0
    for i in range(SRC.index("{", start), len(SRC)):
        depth += {"{": 1, "}": -1}.get(SRC[i], 0)
        if depth == 0:
            return SRC[start : i + 1]
    raise ValueError(name)


def section(text: str, key: str) -> str:
    m = re.search(rf"{key}: \[(.*?)\n  \]", text, re.S)
    return m.group(1)


rows_src = block("CHART_ROWS")
tiers_src = block("TIERS")
pos_src = block("POSITION_BASE")
FORMATS = {"ring": "リングゲーム", "tournament": "トーナメント"}
POSITIONS = ["UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"]
POS_NOTE = {"UTG": "後ろに8人", "UTG+1": "後ろに7人", "MP": "後ろに6人", "LJ": "後ろに5人", "HJ": "後ろに4人",
            "CO": "後ろに3人", "BTN": "後ろに2人", "SB": "後ろに1人", "BB": "最後"}
thin = Side(style="thin", color="999999")
pink = Side(style="thick", color="E6007E")

wb = Workbook()
wb.remove(wb.active)
for fmt, title in FORMATS.items():
    rows = re.findall(r"'([PRYGCWBK.]{13})'", section(rows_src, fmt))
    tiers = [
        dict(code=c, name=n, hex=h, outline=o, meaning=m)
        for c, n, h, o, m in re.findall(
            r"code: '(.)', color: \{ name: '([^']+)', hex: '#(\w+)'(?:, outline: (PINK))? \}, meaning: '([^']+)'",
            section(tiers_src, fmt),
        )
    ]
    base = dict(re.findall(r"'?([A-Z+]+)'?: '([^']+)'", re.search(rf"{fmt}: \{{(.*?)\}}", pos_src, re.S).group(1)))
    by_code = {t["code"]: (i, t) for i, t in enumerate(tiers)}
    ws = wb.create_sheet(title)

    ws["A1"] = f"ヨコサワハンドレンジ表（{title}）"
    ws["A1"].font = Font(bold=True, size=14)
    ws["B2"], ws["B3"] = "手札 →", "ポジション →"
    ws["D2"], ws["D3"] = "AKo", "CO"
    for c in ("D2", "D3"):
        ws[c].fill = PatternFill("solid", fgColor="FFF2CC")
        ws[c].font = Font(bold=True, size=13)
        ws[c].border = Border(left=thin, right=thin, top=thin, bottom=thin)
    dv = DataValidation(type="list", formula1='"' + ",".join(POSITIONS) + '"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add("D3")

    # 表（行5〜17、列C〜O）。見出しは行4・列B
    top, left = 5, 3
    for i, r in enumerate(RANKS):
        h = ws.cell(row=4, column=left + i, value=r)
        v = ws.cell(row=top + i, column=2, value=r)
        for c in (h, v):
            c.font = Font(bold=True, color="555555")
            c.alignment = Alignment(horizontal="center", vertical="center")
            c.fill = PatternFill("solid", fgColor="E5E7EB")
    for r in range(13):
        for c in range(13):
            if r == c:
                hand = RANKS[r] * 2
            elif r < c:
                hand = RANKS[r] + RANKS[c] + "s"
            else:
                hand = RANKS[c] + RANKS[r] + "o"
            _, t = by_code[rows[r][c]]
            cell = ws.cell(row=top + r, column=left + c, value=hand)
            cell.fill = PatternFill("solid", fgColor=t["hex"].upper())
            dark = t["hex"].lower() in ("e60012", "8c7cc0", "5cb531")
            cell.font = Font(bold=True, size=10, color="FFFFFF" if dark else "111111")
            cell.alignment = Alignment(horizontal="center", vertical="center")
            side = pink if t["outline"] else thin
            cell.border = Border(left=side, right=side, top=side, bottom=side)
    for i in range(13):
        ws.column_dimensions[get_column_letter(left + i)].width = 6.2
        ws.row_dimensions[top + i].height = 26
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 12

    # 選んだ手札の行・列（補助セル Q2/R2）
    ws["Q1"], ws["R1"] = "行", "列"
    r1 = 'FIND(LEFT($D$2,1),"AKQJT98765432")'
    r2 = 'FIND(MID($D$2,2,1),"AKQJT98765432")'
    ws["Q2"] = f'=IFERROR(IF(OR(LEN($D$2)=2,RIGHT($D$2,1)="s"),{r1},{r2}),0)'
    ws["R2"] = f'=IFERROR(IF(OR(LEN($D$2)=2,RIGHT($D$2,1)="s"),{r2},{r1}),0)'
    for c in ("Q1", "R1", "Q2", "R2"):
        ws[c].font = Font(color="AAAAAA", size=8)

    grid = f"{get_column_letter(left)}{top}:{get_column_letter(left + 12)}{top + 12}"
    sel_side = Side(style="thin", color="1D4ED8")
    ws.conditional_formatting.add(
        grid,
        FormulaRule(
            formula=[f"AND(ROW({get_column_letter(left)}{top})-{top - 1}=$Q$2,COLUMN({get_column_letter(left)}{top})-{left - 1}=$R$2)"],
            fill=PatternFill("solid", bgColor="1D4ED8", fgColor="1D4ED8"),
            font=Font(bold=True, color="FFFFFF"),
            border=Border(left=sel_side, right=sel_side, top=sel_side, bottom=sel_side),
            stopIfTrue=True,
        ),
    )
    head_fill = PatternFill("solid", bgColor="2563EB", fgColor="2563EB")
    ws.conditional_formatting.add(f"C4:O4", FormulaRule(formula=[f"COLUMN(C4)-2=$R$2"], fill=head_fill, font=Font(color="FFFFFF", bold=True)))
    ws.conditional_formatting.add(f"B5:B17", FormulaRule(formula=[f"ROW(B5)-4=$Q$2"], fill=head_fill, font=Font(color="FFFFFF", bold=True)))

    # 判定欄
    ws["F2"] = "色"
    ws["G2"] = f'=IFERROR(VLOOKUP($D$2,データ!$A$2:$E$170,{2 if fmt == "ring" else 4},FALSE),"（手札を入力）")'
    ws["F3"] = "基準"
    ws["G3"] = f'=IFERROR(VLOOKUP($D$3,データ!$F$2:$H$10,{2 if fmt == "ring" else 3},FALSE),"—")'
    ws["I2"] = "判定"
    lv_hand = f'VLOOKUP($D$2,データ!$A$2:$E$170,{3 if fmt == "ring" else 5},FALSE)'
    lv_pos = f'VLOOKUP(G3,{"リング段階" if fmt == "ring" else "トナメ段階"},2,FALSE)'
    ws["J2"] = f'=IFERROR(IF($D$3="BB","BBは相手のレイズ次第",IF({lv_hand}>={lv_pos},"参加できる（レイズ）","フォールド")),"")'
    for c in ("F2", "F3", "I2"):
        ws[c].font = Font(bold=True)
    ws["J2"].font = Font(bold=True, size=13, color="1D4ED8")

    # 凡例
    ws.cell(row=19, column=2, value="凡例").font = Font(bold=True)
    for i, t in enumerate(tiers):
        sw = ws.cell(row=20 + i, column=3, value=t["name"])
        sw.fill = PatternFill("solid", fgColor=t["hex"].upper())
        side = pink if t["outline"] else thin
        sw.border = Border(left=side, right=side, top=side, bottom=side)
        sw.alignment = Alignment(horizontal="center")
        ws.cell(row=20 + i, column=4, value=t["meaning"])
    r0 = 21 + len(tiers)
    ws.cell(row=r0, column=2, value="使い方：D2 に手札（AKo / 65s / 77）を入力すると青く表示。D3 でポジションを選ぶと参加できるか判定します。")
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.freeze_panes = "A5"
    ws.sheet_view.zoomScale = 110

    # 名前付き段階表（色名 → レベル）
    globals().setdefault("TIER_TABLES", {})[fmt] = tiers
    globals().setdefault("BASES", {})[fmt] = base
    globals().setdefault("ROWS", {})[fmt] = rows

# データシート：ハンド → 色・レベル、ポジション → 基準色、色 → レベル
ds = wb.create_sheet("データ")
ds.append(["ハンド", "リング色", "リング段階", "トナメ色", "トナメ段階", "ポジション", "リング基準", "トナメ基準"])
hands = []
for r in range(13):
    for c in range(13):
        hands.append((r, c, RANKS[r] * 2 if r == c else RANKS[r] + RANKS[c] + "s" if r < c else RANKS[c] + RANKS[r] + "o"))
for i, (r, c, hand) in enumerate(hands):
    vals = [hand]
    for fmt in FORMATS:
        tiers = TIER_TABLES[fmt]
        code = ROWS[fmt][r][c]
        idx = next(k for k, t in enumerate(tiers) if t["code"] == code)
        vals += [tiers[idx]["name"], idx]
    ds.append(vals)
for i, p in enumerate(POSITIONS):
    ds.cell(row=2 + i, column=6, value=p)
    ds.cell(row=2 + i, column=7, value=BASES["ring"].get(p, "—"))
    ds.cell(row=2 + i, column=8, value=BASES["tournament"].get(p, "—"))
from openpyxl.workbook.defined_name import DefinedName
for fmt, col, name in (("ring", 10, "リング段階"), ("tournament", 13, "トナメ段階")):
    ds.cell(row=1, column=col, value=f"{FORMATS[fmt]}の色")
    ds.cell(row=1, column=col + 1, value="段階")
    for k, t in enumerate(TIER_TABLES[fmt]):
        ds.cell(row=2 + k, column=col, value=t["name"])
        ds.cell(row=2 + k, column=col + 1, value=k)
    ref = f"データ!${get_column_letter(col)}$2:${get_column_letter(col + 1)}${1 + len(TIER_TABLES[fmt])}"
    wb.defined_names[name] = DefinedName(name, attr_text=ref)

out = ROOT / "public/yokosawa-ranges.xlsx"
wb.save(out)
print("wrote", out)
