"""Renderiza o manual Markdown como PDF paginado e alinhado à marca Wal Chat."""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "MANUAL_INTERNO_IMPLEMENTACAO_E_OPERACAO.md"
OUTPUT = ROOT / "output" / "pdf" / "manual-interno-wal-chat.pdf"

BLACK = colors.HexColor("#11110F")
CREAM = colors.HexColor("#F2F0EA")
ORANGE = colors.HexColor("#F0522D")
BLUE = colors.HexColor("#2D6CDF")
GREEN = colors.HexColor("#278A64")
GRAY = colors.HexColor("#68665F")
LIGHT_GRAY = colors.HexColor("#D9D6CD")


class WalDocTemplate(BaseDocTemplate):
    def afterPage(self):
        if self.page > 1:
            content_chrome(self.canv, self)


def register_fonts() -> None:
    candidates = [
        (
            Path("C:/Windows/Fonts/arial.ttf"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
            Path("C:/Windows/Fonts/consola.ttf"),
        ),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
        ),
    ]
    for regular, bold, mono in candidates:
        if regular.exists() and bold.exists() and mono.exists():
            pdfmetrics.registerFont(TTFont("WalSans", str(regular)))
            pdfmetrics.registerFont(TTFont("WalSansBold", str(bold)))
            pdfmetrics.registerFont(TTFont("WalMono", str(mono)))
            pdfmetrics.registerFontFamily("WalSans", normal="WalSans", bold="WalSansBold")
            return
    raise RuntimeError("Nenhuma família de fontes compatível foi encontrada.")


def normalize_text(value: str) -> str:
    return (
        value.replace("\u2011", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
    )


def inline_markup(value: str) -> str:
    escaped = html.escape(normalize_text(value.strip()))
    escaped = re.sub(r"`([^`]+)`", r'<font name="WalMono" color="#2D6CDF">\1</font>', escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"\*([^*]+)\*", r"<i>\1</i>", escaped)
    return escaped


def make_styles():
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="WalSans",
            fontSize=9.2,
            leading=12.7,
            textColor=BLACK,
            spaceAfter=6,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="WalSansBold",
            fontSize=19,
            leading=22,
            textColor=BLACK,
            spaceBefore=6,
            spaceAfter=8,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="WalSansBold",
            fontSize=13.5,
            leading=17,
            textColor=BLACK,
            spaceBefore=12,
            spaceAfter=6,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName="WalSansBold",
            fontSize=10.5,
            leading=14,
            textColor=ORANGE,
            spaceBefore=8,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName="WalSans",
            fontSize=9,
            leading=12,
            leftIndent=12,
            firstLineIndent=-7,
            bulletIndent=3,
            textColor=BLACK,
            spaceAfter=3,
        ),
        "code": ParagraphStyle(
            "Code",
            fontName="WalMono",
            fontSize=7.2,
            leading=10,
            textColor=colors.HexColor("#EDEBE3"),
            leftIndent=0,
            rightIndent=0,
            spaceBefore=0,
            spaceAfter=0,
        ),
        "table": ParagraphStyle(
            "TableCell",
            fontName="WalSans",
            fontSize=7.7,
            leading=10.2,
            textColor=BLACK,
        ),
        "table_head": ParagraphStyle(
            "TableHead",
            fontName="WalSansBold",
            fontSize=7.7,
            leading=10.2,
            textColor=colors.white,
        ),
        "cover_kicker": ParagraphStyle(
            "CoverKicker",
            fontName="WalSansBold",
            fontSize=10,
            leading=12,
            textColor=ORANGE,
            alignment=TA_LEFT,
            spaceAfter=12,
        ),
        "cover_title": ParagraphStyle(
            "CoverTitle",
            fontName="WalSansBold",
            fontSize=32,
            leading=35,
            textColor=colors.white,
            alignment=TA_LEFT,
            spaceAfter=14,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            fontName="WalSans",
            fontSize=13,
            leading=18,
            textColor=colors.HexColor("#D7D4CA"),
            alignment=TA_LEFT,
        ),
        "cover_cell": ParagraphStyle(
            "CoverCell",
            fontName="WalSans",
            fontSize=7.7,
            leading=10.2,
            textColor=colors.HexColor("#EDEBE3"),
        ),
    }


def cover_page(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(BLACK)
    canvas.rect(0, 0, width, height, stroke=0, fill=1)
    canvas.setFillColor(ORANGE)
    canvas.rect(width - 52 * mm, 0, 52 * mm, height, stroke=0, fill=1)
    canvas.setFillColor(CREAM)
    canvas.setFont("WalSansBold", 9)
    canvas.drawString(18 * mm, 16 * mm, "F.A.T TECH 2026  /  DOCUMENTO INTERNO")
    canvas.setFillColor(BLACK)
    canvas.setFont("WalSansBold", 26)
    canvas.drawCentredString(width - 26 * mm, height - 28 * mm, "W")
    canvas.restoreState()


def content_background(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, width, height, stroke=0, fill=1)
    canvas.restoreState()


def content_chrome(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setStrokeColor(LIGHT_GRAY)
    canvas.line(18 * mm, height - 16 * mm, width - 18 * mm, height - 16 * mm)
    canvas.setFont("WalSansBold", 7.5)
    canvas.setFillColor(BLACK)
    canvas.drawString(18 * mm, height - 11.5 * mm, "WAL CHAT")
    canvas.setFillColor(GRAY)
    canvas.setFont("WalSans", 7.5)
    canvas.drawRightString(width - 18 * mm, height - 11.5 * mm, "MANUAL INTERNO DE IMPLEMENTAÇÃO E OPERAÇÃO")
    canvas.setStrokeColor(LIGHT_GRAY)
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.setFillColor(GRAY)
    canvas.setFont("WalSans", 7.2)
    canvas.drawString(18 * mm, 9.5 * mm, "Uso interno - não compartilhar secrets ou tokens")
    canvas.drawRightString(width - 18 * mm, 9.5 * mm, f"Página {doc.page}")
    canvas.restoreState()


def parse_markdown(lines: list[str], styles: dict):
    story = []
    paragraph_buffer: list[str] = []
    in_code = False
    code_lines: list[str] = []
    index = 0

    def flush_paragraph():
        if paragraph_buffer:
            story.append(Paragraph(inline_markup(" ".join(paragraph_buffer)), styles["body"]))
            paragraph_buffer.clear()

    while index < len(lines):
        raw = normalize_text(lines[index].rstrip("\n"))
        stripped = raw.strip()

        if stripped.startswith("```"):
            flush_paragraph()
            if in_code:
                code = "\n".join(normalize_text(line) for line in code_lines)
                code_block = Table(
                    [[Preformatted(code, styles["code"], maxLineLength=92)]],
                    colWidths=[A4[0] - 36 * mm],
                    hAlign="LEFT",
                    style=TableStyle([
                        ("BACKGROUND", (0, 0), (-1, -1), BLACK),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("TOPPADDING", (0, 0), (-1, -1), 7),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ]),
                )
                story.extend([code_block, Spacer(1, 7)])
                code_lines.clear()
                in_code = False
            else:
                in_code = True
            index += 1
            continue

        if in_code:
            code_lines.append(raw)
            index += 1
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            flush_paragraph()
            table_lines = []
            while index < len(lines):
                candidate = normalize_text(lines[index].strip())
                if not (candidate.startswith("|") and candidate.endswith("|")):
                    break
                table_lines.append(candidate)
                index += 1
            parsed = [[cell.strip() for cell in line.strip("|").split("|")] for line in table_lines]
            parsed = [row for row in parsed if not all(re.fullmatch(r"[-: ]+", cell) for cell in row)]
            if parsed:
                width = (A4[0] - 36 * mm) / max(len(parsed[0]), 1)
                data = []
                for row_index, row in enumerate(parsed):
                    style = styles["table_head"] if row_index == 0 else styles["table"]
                    data.append([Paragraph(inline_markup(cell), style) for cell in row])
                table = Table(data, colWidths=[width] * len(parsed[0]), repeatRows=1, hAlign="LEFT")
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), BLACK),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.4, LIGHT_GRAY),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.extend([table, Spacer(1, 6)])
            continue

        if not stripped:
            flush_paragraph()
            index += 1
            continue

        heading = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            title = heading.group(2)
            if level == 1:
                index += 1
                continue
            story.append(Paragraph(inline_markup(title), styles[f"h{level}"]))
            if level == 2:
                story.append(HRFlowable(width="100%", thickness=1.2, color=ORANGE, spaceAfter=5))
            index += 1
            continue

        bullet = re.match(r"^-\s+(.+)$", stripped)
        ordered = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if bullet or ordered:
            flush_paragraph()
            marker = "•" if bullet else f"{ordered.group(1)}."
            text = bullet.group(1) if bullet else ordered.group(2)
            story.append(Paragraph(f"{marker} {inline_markup(text)}", styles["bullet"]))
            index += 1
            continue

        paragraph_buffer.append(stripped)
        index += 1

    flush_paragraph()
    return story


def build_pdf() -> None:
    register_fonts()
    styles = make_styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    doc = WalDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title="Wal Chat - Manual interno de implementação e operação",
        author="F.A.T Tech",
        subject="Implantação, contas, integrações, compliance e operação",
    )
    cover_frame = Frame(18 * mm, 35 * mm, A4[0] - 88 * mm, A4[1] - 70 * mm, id="cover")
    content_frame = Frame(18 * mm, 19 * mm, A4[0] - 36 * mm, A4[1] - 39 * mm, id="content")
    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[cover_frame], onPage=cover_page),
        PageTemplate(
            id="Content",
            frames=[content_frame],
            onPage=content_background,
        ),
    ])

    story = [
        Spacer(1, 34 * mm),
        Paragraph("WAL CHAT / OPERAÇÃO", styles["cover_kicker"]),
        Paragraph("Manual interno de implementação e operação", styles["cover_title"]),
        Paragraph(
            "Arquitetura isolada, implantação, contas de usuário, Meta, Gemini, compliance, validação e rotina operacional.",
            styles["cover_subtitle"],
        ),
        Spacer(1, 22 * mm),
        Table(
            [
                [Paragraph("AMBIENTE", styles["table_head"]), Paragraph("HOMOLOGAÇÃO HTTPS", styles["table_head"])],
                [Paragraph("Versão", styles["cover_cell"]), Paragraph("MVP 2026.07", styles["cover_cell"])],
                [Paragraph("Atualização", styles["cover_cell"]), Paragraph("21 de julho de 2026", styles["cover_cell"])],
            ],
            colWidths=[34 * mm, 58 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), ORANGE),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#24241F")),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#4A4942")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]),
        ),
        NextPageTemplate("Content"),
        PageBreak(),
    ]

    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    story.extend(parse_markdown(lines, styles))
    doc.build(story)


if __name__ == "__main__":
    try:
        build_pdf()
    except Exception as exc:
        print(f"Erro ao gerar PDF: {exc}", file=sys.stderr)
        raise
    print(OUTPUT)
