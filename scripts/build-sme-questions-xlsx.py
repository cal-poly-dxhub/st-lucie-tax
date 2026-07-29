#!/usr/bin/env python3
"""
Build docs/tcslc-policy-questions.xlsx — the SME fact/behavior questions workbook.

3 pages: High-Impact Questions, Other Questions, Deferred (lower priority).
Columns: ID | Scenario | Question | Current behavior & why it matters | Citation | TCSLC ANSWER.

Consumes:
  scripts/.cache/sme-questions.json           (parsed MD: questions + deferred)
  scripts/.cache/sme-second-look.json         (workflow output: per-id verification + citation)

The second-look file is a {"results": [...]} list of records:
  {id, stillRelevant, refinedScenario, refinedQuestion, currentBehaviorAndWhy, citation, citationConfidence}
Records with stillRelevant=false are DROPPED (listed in run output so the user can veto).

Thoroughness lives in the cells: generous widths + tall wrapped rows, no truncation.

Requires xlsxwriter >= 3.2.0. If not on system Python:
  python3 -m venv /tmp/xlsx-venv && /tmp/xlsx-venv/bin/pip install 'xlsxwriter>=3.2.0'
  /tmp/xlsx-venv/bin/python scripts/build-sme-questions-xlsx.py
"""

import json
import math
import os
import re

import xlsxwriter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARSED = os.path.join(ROOT, 'scripts/.cache/sme-questions.json')
SECOND_LOOK = os.path.join(ROOT, 'scripts/.cache/sme-second-look.json')
OUT = os.path.join(ROOT, 'docs/tcslc-policy-questions.xlsx')

UNVERIFIED = '⚠ UNVERIFIED — no source'

# Column layout (header, width in chars). Width drives the row-height estimate.
COLS = [
    ('ID', 9),
    ('Scenario', 46),
    ('Question', 50),
    ('Current behavior & why it matters', 56),
    ('Citation (source for current behavior)', 30),
    ('TCSLC ANSWER', 44),
]


def est_row_height(cells):
    """Estimate row height (points) from the longest wrapped cell so nothing is clipped."""
    max_lines = 1
    for (text, (_, width)) in zip(cells, COLS):
        if text is None:
            continue
        s = str(text)
        # account for explicit newlines + wrap by width (~1.05 fudge for proportional font)
        lines = 0
        for para in s.split('\n'):
            lines += max(1, math.ceil((len(para) + 1) / (width * 1.05)))
        max_lines = max(max_lines, lines)
    return min(max(22, max_lines * 15 + 6), 420)  # ~15pt/line, clamp 22..420


def clean_md(text):
    """Normalize MD prose for a spreadsheet cell: turn inline '- ' list markers into
    real line breaks (so a 'list' reads as lines, not a run-on), and tidy whitespace.
    Leaves **bold** markers in place — write_md() turns those into bold runs."""
    if not text:
        return ''
    s = str(text)
    # Inline "... : - item - item" → newline bullets. Only split on " - " that follows
    # a space (avoids splitting hyphenated words / ranges like "24-48").
    s = re.sub(r'\s-\s+', '\n• ', s)
    s = re.sub(r'[ \t]{2,}', ' ', s)
    return s.strip()


def write_md(ws, row, col, text, base_fmt, bold_fmt):
    """Write a cell, rendering **bold** segments as real bold runs via rich strings.
    Falls back to a plain write when there is no bold (write_rich_string needs >1 run)."""
    s = clean_md(text)
    parts = re.split(r'\*\*(.+?)\*\*', s)  # odd indices = bold segments
    if len(parts) == 1:
        ws.write(row, col, s, base_fmt)
        return
    runs = []
    for i, seg in enumerate(parts):
        if seg == '':
            continue
        runs.append(bold_fmt if i % 2 == 1 else None)
        runs.append(seg)
    # Drop leading None (write_rich_string wants string or (fmt,string) pairs).
    cleaned = []
    j = 0
    while j < len(runs):
        if runs[j] is None:
            cleaned.append(runs[j + 1])
            j += 2
        else:
            cleaned.append(runs[j])
            cleaned.append(runs[j + 1])
            j += 2
    ws.write_rich_string(row, col, *cleaned, base_fmt)


# Markdown chars stripped when only measuring height (so ** doesn't inflate line count).
def _measure_text(text):
    return re.sub(r'\*\*', '', clean_md(text))


def main():
    parsed = json.load(open(PARSED))
    questions = {q['id']: q for q in parsed['questions']}
    deferred = parsed['deferred']

    second = {r['id']: r for r in json.load(open(SECOND_LOOK))['results']}

    # Merge: prefer refined text from the second look; fall back to parsed MD.
    kept, dropped = [], []
    for qid, q in questions.items():
        sl = second.get(qid)
        if sl and sl.get('stillRelevant') is False:
            dropped.append((qid, sl.get('relevanceReason', '')))
            continue
        rec = {
            'id': qid,
            'starred': q['starred'],
            'scenario': (sl or {}).get('refinedScenario') or q['scenario'],
            'question': (sl or {}).get('refinedQuestion') or q['question'],
            'why': (sl or {}).get('currentBehaviorAndWhy') or q['whyItMatters'],
            'citation': (sl or {}).get('citation') or UNVERIFIED,
        }
        kept.append(rec)

    high = [r for r in kept if r['starred']]
    other = [r for r in kept if not r['starred']]

    wb = xlsxwriter.Workbook(OUT)

    # ---- formats ----
    fmt_title = wb.add_format({'bold': True, 'font_size': 15, 'font_color': '#003B7A'})
    fmt_blurb = wb.add_format({'font_size': 10, 'font_color': '#475569', 'text_wrap': True, 'valign': 'top'})
    fmt_hdr = wb.add_format({'bold': True, 'font_color': 'white', 'bg_color': '#0055AA',
                             'align': 'center', 'valign': 'vcenter', 'text_wrap': True, 'border': 1})
    fmt_id = wb.add_format({'bold': True, 'valign': 'top', 'border': 1, 'align': 'center', 'bg_color': '#EEF2F7'})
    fmt_cell = wb.add_format({'text_wrap': True, 'valign': 'top', 'border': 1, 'font_size': 10})
    # Inline bold run (same size as fmt_cell) used inside rich strings to render **bold** segments.
    fmt_bold_run = wb.add_format({'bold': True, 'font_size': 10})
    fmt_cite = wb.add_format({'text_wrap': True, 'valign': 'top', 'border': 1, 'font_size': 9, 'font_color': '#334155'})
    fmt_cite_unv = wb.add_format({'text_wrap': True, 'valign': 'top', 'border': 1, 'font_size': 9,
                                  'font_color': '#B91C1C', 'bold': True})
    fmt_answer = wb.add_format({'text_wrap': True, 'valign': 'top', 'border': 2, 'bg_color': '#FFFBEA',
                                'border_color': '#CA8A04'})

    def build_sheet(tab, title, blurb, rows, deferred_rows=None):
        ws = wb.add_worksheet(tab)
        for c, (_, w) in enumerate(COLS):
            ws.set_column(c, c, w)
        ncol = len(COLS)

        ws.merge_range(0, 0, 0, ncol - 1, f'St. Lucie Tax Collector — {title}', fmt_title)
        ws.merge_range(1, 0, 1, ncol - 1, blurb, fmt_blurb)
        ws.set_row(1, 78)

        hdr = 3
        for c, (h, _) in enumerate(COLS):
            ws.write(hdr, c, h, fmt_hdr)
        ws.set_row(hdr, 34)
        ws.freeze_panes(hdr + 1, 1)  # freeze header row + ID column

        r = hdr + 1
        if deferred_rows is None:
            for rec in rows:
                cite = rec['citation']
                # Height from the CLEANED/measured text (so ** and ' - ' don't skew it).
                cells = [rec['id'], _measure_text(rec['scenario']), _measure_text(rec['question']),
                         _measure_text(rec['why']), cite, '']
                ws.write(r, 0, rec['id'], fmt_id)
                write_md(ws, r, 1, rec['scenario'], fmt_cell, fmt_bold_run)
                write_md(ws, r, 2, rec['question'], fmt_cell, fmt_bold_run)
                write_md(ws, r, 3, rec['why'], fmt_cell, fmt_bold_run)
                cite_fmt = fmt_cite_unv if cite.startswith('⚠') else fmt_cite
                ws.write(r, 4, cite, cite_fmt)
                ws.write(r, 5, '', fmt_answer)
                ws.set_row(r, est_row_height(cells))
                r += 1
        else:
            # Deferred page: topic + body, same column shape (ID col holds a D# index).
            for i, d in enumerate(deferred_rows, 1):
                cells = [f'D-{i}', _measure_text(d['topic']), _measure_text(d['body']), '', '', '']
                ws.write(r, 0, f'D-{i}', fmt_id)
                write_md(ws, r, 1, d['topic'], fmt_cell, fmt_bold_run)
                write_md(ws, r, 2, d['body'], fmt_cell, fmt_bold_run)
                ws.write(r, 3, '', fmt_cell)
                ws.write(r, 4, '', fmt_cite)
                ws.write(r, 5, '', fmt_answer)
                ws.set_row(r, est_row_height(cells))
                r += 1

    build_sheet(
        'High-Impact Questions',
        'Policy Questions for SLCTC — High Impact',
        'These are the highest-impact questions where the chatbot currently guesses, cannot verify a rule, or '
        'turns away a possibly-serviceable customer. Please type your answer in the yellow "TCSLC ANSWER" '
        'column for each row. The "Citation" column shows the source we currently rely on for the bot\'s '
        'behavior — a red "⚠ UNVERIFIED — no source" means we are currently guessing, so your answer there is '
        'especially valuable. Most can be answered in two or three sentences.',
        high,
    )
    build_sheet(
        'Other Questions',
        'Policy Questions for SLCTC — Additional',
        'Additional questions, same format as page 1. Answer any you can in the yellow "TCSLC ANSWER" column. '
        'A red "⚠ UNVERIFIED — no source" citation marks behavior we could not confirm against FLHSMV / '
        'tcslc.com / statute — your confirmation there is especially valuable.',
        other,
    )
    build_sheet(
        'Deferred (lower priority)',
        'Policy Questions for SLCTC — Deferred / Lower Priority',
        'Lower-priority items we intentionally set aside, listed for transparency. No need to answer these now '
        '— flag any you would like us to promote, or jot a note in the ANSWER column if you have a quick take.',
        None,
        deferred_rows=deferred,
    )

    wb.close()

    # ---- run summary ----
    cited = sum(1 for r in kept if not r['citation'].startswith('⚠'))
    unv = sum(1 for r in kept if r['citation'].startswith('⚠'))
    print(f'Wrote {OUT}')
    print(f'Kept {len(kept)} questions  (High-Impact: {len(high)}, Other: {len(other)})')
    print(f'Deferred page: {len(deferred)} items')
    print(f'Citation coverage: {cited} cited, {unv} UNVERIFIED')
    if dropped:
        print(f'\nDROPPED {len(dropped)} questions (resolved in current data model — VETO if wrong):')
        for qid, reason in dropped:
            print(f'  - {qid}: {reason[:120]}')
    else:
        print('\nNo questions dropped — all 31 still relevant.')


if __name__ == '__main__':
    main()
