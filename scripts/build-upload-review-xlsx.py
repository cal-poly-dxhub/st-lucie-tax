#!/usr/bin/env python3
"""
Generate docs/tcslc-document-upload-review.xlsx — a checklist for TCSLC to mark
which documents the CHATBOT APP should let residents upload ahead of their visit.
Accepted uploads are forwarded to the clerk so the paperwork is handled before the
resident arrives (the clerk handoff is part of our app, separate from the chatbot).

One worksheet per category. Real one-click Excel checkboxes (xlsxwriter native
cell-control checkboxes — boolean TRUE/FALSE cells that render as checkboxes).

Read-only over item-catalog.json + decision-trees/*.json. One-off generator.

Requires xlsxwriter >= 3.2.0 (for insert_checkbox). If not on the system Python:
    python3 -m venv /tmp/xlsx-venv && /tmp/xlsx-venv/bin/pip install 'xlsxwriter>=3.2.0'
    /tmp/xlsx-venv/bin/python scripts/build-upload-review-xlsx.py
"""

import json
import os
from collections import defaultdict

import xlsxwriter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CATALOG = os.path.join(ROOT, 'services/chatbot/src/data/item-catalog.json')
TREES_DIR = os.path.join(ROOT, 'services/chatbot/src/data/decision-trees')
OUT_EXCEL = os.path.join(ROOT, 'docs/tcslc-document-upload-review-EXCEL.xlsx')
OUT_GOOGLE = os.path.join(ROOT, 'docs/tcslc-document-upload-review-GOOGLE-SHEETS.xlsx')

# In Excel mode we emit native cell-control checkboxes (one click). Google Sheets
# does NOT understand that format — it shows the raw TRUE/FALSE. So in Google mode
# we emit plain boolean cells plus a banner telling the reviewer to run
# Insert > Checkbox on the two columns (a one-time ~5-sec step that turns the
# booleans into real Google checkboxes). No file format gives one-click checkboxes
# in BOTH apps offline; these are two purpose-built copies.

# --------------------------------------------------------------------------- #
# Category ruleset — hand-curated override lists (the load-bearing part).
# The catalog mixes documents, payments, conditions, and referrals under the
# same `bucket` values, so explicit id lists are needed for correct grouping.
# --------------------------------------------------------------------------- #

PAYMENT_IDS = {
    'guaranteed-funds-only', 'personal-check-ok', 'all-tangible-taxes-paid',
    'cdl-application-fee', 'cdl-late-fee', 'cdl-endorsement-fee-per',
    'hazmat-tsa-fee', 'reinstatement-fee', 'fwc-license-fee',
    'btr-application-fee', 'ccw-application-fee',
    'payment-15-original-temporary', 'payment-15-visitor-temporary',
    'payment-1-replacement',
}

PHYSICAL_IDS = {
    'vin-verification-completed', 'hsmv-82042',
    'physical-license-plate-for-surrender', 'existing-physical-plate-or-number',
    'license-plate-surrender-affidavit', 'lpsa-signed-by-registered-owner',
    'vehicle-for-road-test', 'fl-insurance-proof-for-test-vehicle',
    'vessel-hull-id-documented', 'oos-title-surrender', 'oos-vessel-title-surrender',
    'all-applicants-present', 'all-trustees-present-or-poa', 'adult-co-purchaser-present',
    'cdl-skills-exam', 'cdl-general-knowledge-exam', 'hazmat-written-test',
}

REFERRAL_IDS = {
    'mydmv-portal-referral', 'btr-online-referral', 'tdt-online-referral',
    'touristexpress-referral',
    'walton-road-test-parking-guide', 'tradition-road-test-parking-guide',
    'ft-pierce-road-test-parking-guide',
    'cdl-general-knowledge-exam-scheduling', 'ssa-record-updated',
    'rp-decal-note', 'specialty-plate-packet-guide', 'fl-discount-schedule',
}

IDENTITY_IDS = {
    'photo-id-all-applicants', 'parent-id-valid', 'fl-driver-license',
    'fl-driver-license-to-renew', 'florida-dl-or-id', 'oos-license',
    'visitor-acceptable-photo-id', 'social-security-card',
    'address-proof-1', 'address-proof-2',
}
# plus prefix match: primary-id-*, lawful-presence-*

ORIGINAL_IDS = {
    'original-vehicle-title', 'mco-or-signed-title', 'prior-fl-title-signed-by-seller',
    'vessel-title-or-mco-or-bill-of-sale',
    'death-certificate', 'death-certificate-inheritance',
    'name-change-marriage-cert', 'name-change-divorce-decree', 'name-change-court-order',
    'certified-driving-record', 'certified-weight-slip',
    'customs-import-documents',
}

# Category metadata: key -> (order, sheet-tab name, full title, page blurb)
CATEGORIES = {
    'verifiable': (1, 'Verifiable Copies',
        'Verifiable copies — informational documents (PRIME upload candidates)',
        'Proofs a clerk reads for information; the office does not keep the original. These are the strongest candidates for the chatbot to accept ahead of time. The 2 highlighted rows at the top are ALREADY accepted in the app today (shown for reference). For the rest: check "Accept upload in chatbot?" for any document you want residents to be able to submit before their visit so the clerk has it ready.'),
    'identity': (2, 'Identity Documents',
        'Identity / lawful-presence documents',
        'Identity proofs. Historically presented in person, but check "Accept upload in chatbot?" for any your office is comfortable having residents submit ahead of time for the clerk to review. (The driver license itself is already captured by the in-app ID scan.)'),
    'form': (3, 'Fill-Out Forms',
        'Fill-out forms (HSMV / county PDFs)',
        'Forms the resident completes. Check "Accept upload in chatbot?" for any where a completed/signed scan is useful to hand the clerk before the visit.'),
    'original': (4, 'Originals & Certified',
        'Original / certified documents — surrendered or inspected',
        'Documents where the physical original is normally surrendered or inspected at the counter (signed title, MCO, certified vital records). Generally NOT upload candidates — included so you can confirm or override.'),
    'payment': (5, 'Payments',
        'Payments (not documents)',
        'Fees, funds, and taxes — collected at the counter or online checkout. Not uploadable documents; listed only for completeness.'),
    'physical': (6, 'Physical & In-Person',
        'Physical items / in-person conditions',
        'The vehicle, VIN verification, the plate being surrendered, being physically present, passing an exam. Cannot be uploaded; listed only for completeness.'),
    'referral': (7, 'Referrals & Non-Docs',
        'Referrals / not-a-document',
        'Online-portal links, parking-guide PDFs, exam scheduling, and prerequisite-task markers. Nothing for the resident to upload; listed only for completeness.'),
}

# Items already accepted as uploads today (bucket == optional_upload). They are
# shown at the top of the Verifiable Copies sheet for reference, pre-checked.
CONFIRMED_NOTE = 'Already accepted in the app today'


def categorize(item):
    iid = item['itemId']
    bucket = item['bucket']
    if bucket == 'optional_upload':
        return 'verifiable'  # display at top of verifiable sheet (already-accepted)
    if iid in PAYMENT_IDS:
        return 'payment'
    if iid in PHYSICAL_IDS:
        return 'physical'
    if iid in REFERRAL_IDS:
        return 'referral'
    if iid in IDENTITY_IDS or iid.startswith('primary-id-') or iid.startswith('lawful-presence-'):
        return 'identity'
    if iid in ORIGINAL_IDS:
        return 'original'
    if bucket == 'form':
        return 'form'
    return 'verifiable'  # remaining bring_in items


def load_applicability():
    """Count distinct transaction trees referencing each item (baseItems + branch addItems)."""
    item_trees = defaultdict(set)
    for f in os.listdir(TREES_DIR):
        if not f.endswith('.json'):
            continue
        t = json.load(open(os.path.join(TREES_DIR, f)))
        txn = t.get('txnTypeId', f)
        for iid in t.get('baseItems', []) or []:
            item_trees[iid].add(txn)
        for b in t.get('branches', []) or []:
            for iid in b.get('addItems', []) or []:
                item_trees[iid].add(txn)
    return {iid: len(trees) for iid, trees in item_trees.items()}


def build(mode, out_path, catalog, applic, by_cat):
    """mode: 'excel' (native checkboxes) | 'google' (boolean cells + Insert>Checkbox banner)."""
    wb = xlsxwriter.Workbook(out_path)

    # --- formats ---
    fmt_title = wb.add_format({'bold': True, 'font_size': 14, 'font_color': '#003B7A'})
    fmt_blurb = wb.add_format({'font_size': 10, 'font_color': '#475569', 'text_wrap': True, 'valign': 'top'})
    fmt_hdr = wb.add_format({'bold': True, 'font_color': 'white', 'bg_color': '#0055AA',
                             'align': 'center', 'valign': 'vcenter', 'text_wrap': True, 'border': 1})
    fmt_cell = wb.add_format({'text_wrap': True, 'valign': 'top', 'border': 1})
    fmt_center = wb.add_format({'align': 'center', 'valign': 'vcenter', 'border': 1})
    fmt_link = wb.add_format({'font_color': '#0563C1', 'underline': 1, 'font_size': 9,
                              'text_wrap': True, 'valign': 'top', 'border': 1})
    fmt_cb = wb.add_format({'align': 'center', 'valign': 'vcenter', 'border': 1})
    # Highlight for the already-accepted reference rows
    fmt_cell_hi = wb.add_format({'text_wrap': True, 'valign': 'top', 'border': 1, 'bg_color': '#C6EFCE'})
    fmt_center_hi = wb.add_format({'align': 'center', 'valign': 'vcenter', 'border': 1, 'bg_color': '#C6EFCE'})
    fmt_link_hi = wb.add_format({'font_color': '#0563C1', 'underline': 1, 'font_size': 9,
                                 'text_wrap': True, 'valign': 'top', 'border': 1, 'bg_color': '#C6EFCE'})
    fmt_cb_hi = wb.add_format({'align': 'center', 'valign': 'vcenter', 'border': 1, 'bg_color': '#C6EFCE'})
    fmt_banner = wb.add_format({'bold': True, 'font_color': '#9C4221', 'bg_color': '#FEEBC8',
                                'text_wrap': True, 'valign': 'vcenter', 'border': 1})

    HEADERS = ['Document / Item', 'Used in # services',
               'Accept upload in chatbot?', 'Bring in person?', 'Source / policy', 'Notes']
    WIDTHS = [44, 14, 18, 14, 40, 52]

    total = 0
    summary = {}
    for cat_key in sorted(by_cat, key=lambda k: CATEGORIES[k][0]):
        _, tab, title, blurb = CATEGORIES[cat_key]
        items = by_cat[cat_key]
        summary[cat_key] = len(items)
        ws = wb.add_worksheet(tab)

        for c, w in enumerate(WIDTHS):
            ws.set_column(c, c, w)

        # Title + blurb
        ws.merge_range(0, 0, 0, len(HEADERS) - 1, f'St. Lucie Tax Collector — {title}', fmt_title)
        ws.merge_range(1, 0, 1, len(HEADERS) - 1, blurb, fmt_blurb)
        ws.set_row(1, 60)

        # Google mode: banner explaining the one-time checkbox conversion.
        hdr = 3
        if mode == 'google':
            banner = ('TO TURN ON CHECKBOXES (one time per sheet): select columns C and D, '
                      'then menu Insert ▸ Checkbox. The TRUE/FALSE values become real checkboxes.')
            ws.merge_range(2, 0, 2, len(HEADERS) - 1, banner, fmt_banner)
            ws.set_row(2, 30)
            hdr = 4

        # Header row
        for c, h in enumerate(HEADERS):
            ws.write(hdr, c, h, fmt_hdr)
        ws.set_row(hdr, 32)
        ws.freeze_panes(hdr + 1, 0)

        r = hdr + 1
        for item in items:
            already = item['bucket'] == 'optional_upload'
            cellf = fmt_cell_hi if already else fmt_cell
            ctrf = fmt_center_hi if already else fmt_center
            linkf = fmt_link_hi if already else fmt_link
            cbf = fmt_cb_hi if already else fmt_cb

            label = item['label']
            if already:
                label = f'✅ {label}  ({CONFIRMED_NOTE})'
            ws.write(r, 0, label, cellf)
            ws.write(r, 1, applic.get(item['itemId'], 0), ctrf)
            if mode == 'excel':
                # REAL one-click checkboxes (native Excel cell-control checkbox)
                ws.insert_checkbox(r, 2, bool(already), cbf)  # Accept upload — pre-checked for already-accepted
                ws.insert_checkbox(r, 3, False, cbf)          # Bring in person
            else:
                # Google: plain booleans → become real checkboxes via Insert>Checkbox
                ws.write_boolean(r, 2, bool(already), cbf)
                ws.write_boolean(r, 3, False, cbf)
            src = item.get('source', '') or ''
            if src.startswith('http'):
                ws.write_url(r, 4, src, linkf, src)
            else:
                ws.write(r, 4, src, cellf)
            ws.write(r, 5, item.get('notes', '') or '', cellf)
            r += 1
            total += 1

    wb.close()
    assert total == len(catalog), f'MISMATCH ({mode}): {total} placed, expected {len(catalog)}'
    print(f'Wrote {out_path}  [{mode}] — {total} items')
    return summary


def main():
    catalog = json.load(open(CATALOG))
    applic = load_applicability()

    by_cat = defaultdict(list)
    for item in catalog:
        by_cat[categorize(item)].append(item)

    def sort_key(item):
        already = 0 if item['bucket'] == 'optional_upload' else 1
        return (already, -applic.get(item['itemId'], 0), item['label'].lower())
    for cat in by_cat:
        by_cat[cat].sort(key=sort_key)

    build('excel', OUT_EXCEL, catalog, applic, by_cat)
    summary = build('google', OUT_GOOGLE, catalog, applic, by_cat)

    print('Per-sheet counts:')
    for cat_key in sorted(summary, key=lambda k: CATEGORIES[k][0]):
        print(f'  {CATEGORIES[cat_key][0]}. {CATEGORIES[cat_key][1]:22} {summary[cat_key]}')


if __name__ == '__main__':
    main()
