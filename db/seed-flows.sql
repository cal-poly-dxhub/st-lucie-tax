-- Auto-generated from services/chatbot/src/data/decision-trees/*.json
-- Run: node db/generate-flow-seed.mjs > db/seed-flows.sql
--
-- Inserts decision trees into transaction_flows.steps JSONB.
-- Requires transaction_types to be seeded first (for FK resolution).

INSERT INTO transaction_flows (txn_type_id, steps)
SELECT tt.id, tree.steps
FROM (VALUES
  ('business-tax-receipt', '{
  "txnTypeId": "business-tax-receipt",
  "baseItems": ["photo-id-all-applicants", "btr-application-fee"],
  "factsRequired": [
    "btr_intent",
    "btr_jurisdiction",
    "btr_is_fictitious_name",
    "btr_business_type_category",
    "btr_has_state_license",
    "btr_has_zoning_approval",
    "btr_needs_fire_inspection",
    "btr_exemption_claim",
    "is_100_percent_disabled_veteran"
  ],
  "branches": [
    {
      "when": { "btr_intent": "renewal" },
      "addItems": ["existing-btr-account-number"],
      "removeItems": ["photo-id-all-applicants"],
      "note": "BTR renewal — look up the existing account by name or account number at county-taxes.net/stlucie and pay the amount due. Can be completed online; no in-office documents needed unless modifying the record.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_intent": "modify" },
      "note": "Modifying an existing BTR (change of address, ownership, classification) — contact the Tax Specialist team directly at taxspecialist@tcslc.com; this isn''t completed at the counter.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_intent": "close" },
      "addItems": ["btr-closure-form", "existing-btr-account-number"],
      "removeItems": ["photo-id-all-applicants", "btr-application-fee"],
      "note": "Closing a BTR — complete the Business Tax Closure JotForm linked from the tcslc Local Business Tax page. No fee to close.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_is_fictitious_name": "yes" },
      "addItems": ["sunbiz-registration"],
      "note": "Using a name other than your legal first and last name (a fictitious/DBA name or business entity) — you must first register with the Florida Division of Corporations (SunBiz) and present proof.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax", "https://search.sunbiz.org/"]
    },
    {
      "when": { "btr_jurisdiction": "port-st-lucie" },
      "addItems": ["city-btr-port-st-lucie"],
      "note": "Business located within the City of Port St. Lucie — you MUST obtain both the City of Port St. Lucie Business Tax receipt (772-344-4356) AND the county BTR. Operating on only one is a violation.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_jurisdiction": "fort-pierce" },
      "addItems": ["city-btr-fort-pierce"],
      "note": "Business located within the City of Fort Pierce — you MUST obtain both the City of Fort Pierce Certificate of Use (772-467-3065) AND the county BTR. Operating on only one is a violation.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_jurisdiction": "st-lucie-village" },
      "addItems": ["city-btr-st-lucie-village"],
      "note": "Business located within St. Lucie Village — you MUST obtain both the Village Business Tax receipt (772-466-6900) AND the county BTR.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_jurisdiction": "unincorporated", "btr_has_zoning_approval": "no" },
      "addItems": ["slc-zoning-approval"],
      "note": "BLOCKED: Unincorporated-area businesses must complete the St. Lucie County Zoning process BEFORE applying for a BTR. Visit stluciecountyfl-energovpub.tylerhost.net or call 772-462-2822.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_needs_fire_inspection": "yes-commercial" },
      "addItems": ["slc-fire-inspection"],
      "note": "Commercial locations in unincorporated St. Lucie County require a Fire Inspection from St. Lucie County Fire District (772-621-3377) before BTR issuance.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": {
        "btr_business_type_category": "regulated-profession",
        "btr_has_state_license": "no-required"
      },
      "note": "BLOCKED: Your occupation is regulated by a state agency — you must obtain the state-level professional license BEFORE applying for a BTR.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": {
        "btr_business_type_category": "regulated-profession",
        "btr_has_state_license": "yes"
      },
      "addItems": ["state-professional-license"],
      "note": "Regulated profession — present the state-issued professional license (DBPR, FDACS, etc.) at application.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_business_type_category": "pest-control" },
      "addItems": ["fdacs-pest-control-certification"],
      "note": "Pest Control / Lawn & Landscape businesses using fertilizers or pesticides MUST contact the Florida Department of Agriculture (St. Lucie County Extension 772-462-1660) BEFORE applying for BTR. See fdacs.gov/Business-Services/Pest-Control/Licensing-and-Certification.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax", "https://www.fdacs.gov/"]
    },
    {
      "when": { "btr_business_type_category": "lawn-landscape" },
      "addItems": ["fdacs-pest-control-certification"],
      "note": "Lawn/Landscape businesses that apply fertilizers or pesticides need FDACS certification before BTR.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax", "https://www.fdacs.gov/"]
    },
    {
      "when": { "btr_exemption_claim": "nonprofit-501c3" },
      "addItems": ["btr-exemption-form", "nonprofit-501c3-proof"],
      "removeItems": ["btr-application-fee"],
      "note": "§205.192 nonprofit exemption — 501(c)(3) organizations are exempt. Submit BTR Exemption Form (DocumentCenter/View/257) with proof of federal 501(c)(3) determination.",
      "sourceRefs": [
        "https://www.tcslc.com/227/Local-Business-Tax",
        "https://www.tcslc.com/DocumentCenter/View/257"
      ]
    },
    {
      "when": { "btr_exemption_claim": "religious" },
      "addItems": ["btr-exemption-form"],
      "removeItems": ["btr-application-fee"],
      "note": "§205.191 religious tenets exemption. Submit the BTR Exemption Form.",
      "sourceRefs": ["https://www.tcslc.com/DocumentCenter/View/257"]
    },
    {
      "when": { "btr_exemption_claim": "agriculture" },
      "addItems": ["btr-exemption-form"],
      "removeItems": ["btr-application-fee"],
      "note": "§205.064 agricultural/farm/grove/floricultural exemption — includes tropical fish farms and related manufacturing. Submit the BTR Exemption Form.",
      "sourceRefs": ["https://www.tcslc.com/DocumentCenter/View/257"]
    },
    {
      "when": { "btr_exemption_claim": "veteran-discount" },
      "addItems": ["dd214-or-veteran-id"],
      "note": "Florida''s Veterans Licensing Fee Waiver program reduces BTR-related fees for eligible veterans. Present DD-214 or VA documentation.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "is_100_percent_disabled_veteran": "yes" },
      "addItems": ["va-100-percent-disability-letter"],
      "note": "100% total-and-permanent-disabled veterans may qualify for BTR fee reduction under Florida''s veterans fee-waiver program. Present VA letter.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    },
    {
      "when": { "btr_intent": "new-application" },
      "addItems": ["btr-online-referral"],
      "removeItems": ["btr-application-fee"],
      "note": "New county Business Tax Receipt applications are fully online via the county portal (stlucie.county-taxes.com/btexpress) — there is no in-office application channel. Fees are calculated automatically based on the business classification you select and paid in the portal; no separate in-office fee, no office visit needed for the county BTR.",
      "sourceRefs": ["https://www.tcslc.com/227/Local-Business-Tax"]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [],
    "tcslcVerified": [
      "https://www.tcslc.com/227/Local-Business-Tax",
      "https://www.tcslc.com/DocumentCenter/View/257"
    ],
    "statutes": []
  }
}
'::jsonb),
  ('cdl', '{
  "txnTypeId": "cdl",
  "baseItems": [
    "primary-id-passport",
    "social-security-card",
    "address-proof-1",
    "address-proof-2",
    "cdl-application-fee"
  ],
  "factsRequired": [
    "cdl_origin",
    "cdl_expiration_range",
    "oos_cdl_valid",
    "is_us_citizen",
    "has_primary_id",
    "has_social_security_card",
    "address_proof_count",
    "medical_cert_required",
    "medical_cert_in_system",
    "has_hazmat_endorsement_request",
    "has_tsa_fee",
    "general_knowledge_exam_passed",
    "general_knowledge_exam_age",
    "skills_exam_passed",
    "clp_age_weeks",
    "is_school_employee",
    "can_communicate_in_english",
    "wears_corrective_lenses",
    "applicant_age_meets_cdl",
    "is_100_percent_disabled_veteran"
  ],
  "branches": [
    {
      "when": {
        "cdl_origin": "fl-renewal",
        "cdl_expiration_range": "expired-more-than-1yr"
      },
      "note": "BLOCKED for renewal: FL cannot renew a CDL expired more than 12 months. Customer must re-apply as an Original CDL \u2014 full knowledge + skills testing required.",
      "addItems": ["cdl-general-knowledge-exam", "cdl-skills-exam"]
    },
    {
      "when": {
        "cdl_origin": "fl-renewal",
        "cdl_expiration_range": "expired-less-than-1yr"
      },
      "addItems": ["cdl-late-fee"],
      "note": "Renewal with less-than-1yr expiration: CDL late fee applies in addition to renewal fee."
    },
    {
      "when": {
        "cdl_origin": "oos-transfer",
        "oos_cdl_valid": "valid"
      },
      "addItems": ["valid-out-of-state-cdl"],
      "note": "Valid OOS CDL in hand: no re-testing. Proceed to issuance once identity + residency documents clear."
    },
    {
      "when": {
        "cdl_origin": "oos-transfer",
        "oos_cdl_valid": "invalid"
      },
      "addItems": ["cdl-general-knowledge-exam", "cdl-skills-exam"],
      "note": "Invalid OOS CDL: customer must re-test written and skills, OR return to issuing state to renew and come back with a valid CDL."
    },
    {
      "when": {
        "cdl_origin": "fl-original-first-time"
      },
      "addItems": ["cdl-general-knowledge-exam"],
      "note": "First-time FL CDL requires General Knowledge exam passed. Skills exam only after CLP has been held 2+ weeks."
    },
    {
      "when": {
        "cdl_origin": "fl-clp-upgrade",
        "clp_age_weeks": "2-weeks-or-more"
      },
      "addItems": ["cdl-skills-exam"],
      "note": "CLP held 2+ weeks \u2014 eligible for skills exam to upgrade to CDL."
    },
    {
      "when": {
        "cdl_origin": "fl-clp-upgrade",
        "clp_age_weeks": "less-than-2-weeks"
      },
      "note": "BLOCKED: Skills exam not eligible until CLP has been held 2 weeks. Reschedule for a date after the 2-week mark."
    },
    {
      "when": {
        "general_knowledge_exam_age": "more-than-1yr"
      },
      "addItems": ["cdl-general-knowledge-exam", "cdl-skills-exam"],
      "note": "General Knowledge passed more than 12 months ago \u2014 customer must re-test all written and skills exams."
    },
    {
      "when": {
        "general_knowledge_exam_passed": "passed-not-in-adlts"
      },
      "addItems": ["certified-driving-record"],
      "note": "Exam pass not visible in ADLTS \u2014 customer needs certified driving record / transcript to prove it."
    },
    {
      "when": {
        "applicant_age_meets_cdl": "no"
      },
      "note": "BLOCKED: CDL exams require age 17.5+. Interstate CDL requires 21+; intrastate FL CDL requires 18+."
    },
    {
      "when": {
        "medical_cert_required": "yes",
        "medical_cert_in_system": "no"
      },
      "addItems": ["cdl-medical-cert-uploaded"],
      "note": "BLOCKED until physician''s office uploads the medical examiner''s certificate to the FL state system. FL does not accept the paper card at the counter."
    },
    {
      "when": {
        "medical_cert_required": "yes",
        "medical_cert_in_system": "yes"
      },
      "addItems": ["cdl-medical-cert-uploaded"],
      "note": "Medical card is already in the FL system \u2014 nothing further needed, but item is listed for clerk verification."
    },
    {
      "when": {
        "has_hazmat_endorsement_request": "yes",
        "has_tsa_fee": "yes"
      },
      "addItems": ["hazmat-tsa-fee", "hazmat-written-test", "cdl-endorsement-fee-per"],
      "note": "Hazmat: TSA fee $91 plus $7 endorsement fee plus hazmat written test (English/Spanish, 60-day validity). Walton office does NOT have a hazmat machine \u2014 schedule at a different office."
    },
    {
      "when": {
        "has_hazmat_endorsement_request": "yes",
        "has_tsa_fee": "no"
      },
      "note": "BLOCKED: Customer needs $91 TSA background check fee before hazmat can proceed. Reschedule once funded."
    },
    {
      "when": {
        "address_proof_count": "zero"
      },
      "addItems": ["declaration-of-domicile"],
      "removeItems": ["address-proof-1", "address-proof-2"],
      "note": "No qualifying address docs \u2014 Declaration of Domicile required. Note CDL customers CANNOT use the Address Certification Form (shortcut available for Class E is not available for CDL)."
    },
    {
      "when": {
        "is_school_employee": "yes"
      },
      "addItems": ["school-employee-letter-or-id"],
      "note": "School employees must provide employment ID or school department letter on every original and renewal."
    },
    {
      "when": {
        "is_us_citizen": "permanent-resident"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-green-card"]
    },
    {
      "when": {
        "is_us_citizen": "temporary-lawful-presence"
      },
      "note": "BLOCKED: FL CDL issuance requires US citizenship or lawful permanent residency. Temporary lawful presence does not qualify."
    },
    {
      "when": {
        "has_primary_id": "birth-certificate"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-birth-certificate"]
    },
    {
      "when": {
        "has_primary_id": "naturalization-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-naturalization-cert"]
    },
    {
      "when": {
        "can_communicate_in_english": "no"
      },
      "note": "BLOCKED: Effective Feb 6 2026, FL DL exams are English-only. CDL General Knowledge must be passed in English and cannot be taken in audio form. Hazmat retest retains English/Spanish audio option."
    },
    {
      "when": {
        "wears_corrective_lenses": "yes-not-with-me"
      },
      "addItems": ["vision-test-or-dl10"],
      "note": "Vision test failure or missing lenses \u2192 must return with lenses or complete HSMV 72010 with eye doctor."
    },
    {
      "when": {
        "is_100_percent_disabled_veteran": "yes"
      },
      "addItems": ["va-summary-of-benefits-letter"],
      "removeItems": ["cdl-application-fee"],
      "note": "100% T&P service-connected disabled veterans qualify for fee waiver on the Florida CDL per F.S. \u00a7322.21(1). Bring the VA Summary of Benefits letter showing the 100% rating in lieu of the application fee.",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/322.21",
        "https://www.flhsmv.gov/military/"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - CDL.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/commercial-driver-license/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/commercial-motor-vehicle-drivers/commercial-driver-license/cdl-medical-certification/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/301/Commercial-Driver-License-CDL"],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/322.53",
      "https://www.flsenate.gov/Laws/Statutes/2024/322.54"
    ],
    "gpt": ["Driver License - CDL - GPT Responses.docx"],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/EO04.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/EO03.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR05.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR06.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR07.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06B.pdf"
    ]
  }
}
'::jsonb),
  ('concealed-weapon', '{
  "txnTypeId": "concealed-weapon",
  "baseItems": ["photo-id-all-applicants", "ccw-firearms-training-document", "ccw-application-fee"],
  "factsRequired": [
    "ccw_intent",
    "ccw_applicant_age_bracket",
    "is_us_citizen",
    "ccw_has_training_document",
    "recent_name_change",
    "ccw_has_disqualifying_history"
  ],
  "branches": [
    {
      "when": { "ccw_has_disqualifying_history": "yes" },
      "note": "BLOCKED — potentially ineligible. FDACS may deny applicants with a felony conviction (unless rights restored), domestic-violence injunction, adjudication withheld on a crime of violence within 3 years, two DUI convictions in the last 3 years, drug/alcohol abuse history, mental-health adjudication, dishonorable discharge, fugitive status, or renunciation of US citizenship. Customer should review the Application Instructions PDF and call FDACS (1-850-245-5691) before scheduling an appointment.",
      "sourceRefs": [
        "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Eligibility-Requirements",
        "https://www.flsenate.gov/Laws/Statutes/2024/790.06"
      ]
    },
    {
      "when": { "ccw_applicant_age_bracket": "under-18" },
      "note": "BLOCKED: Florida CCW minimum age is 21. Applicants 18-20 qualify ONLY if they are current US servicemembers (per §250.01) or honorably-discharged veterans. Under 18 never qualifies.",
      "sourceRefs": [
        "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Eligibility-Requirements",
        "https://www.flsenate.gov/Laws/Statutes/2024/790.06"
      ]
    },
    {
      "when": { "ccw_applicant_age_bracket": "18-to-20-not-military" },
      "note": "BLOCKED: 18-20 year olds qualify for Florida CCW ONLY if they are current US servicemembers or honorably-discharged veterans. Other 18-20 applicants must wait until age 21.",
      "sourceRefs": [
        "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Eligibility-Requirements",
        "https://www.flsenate.gov/Laws/Statutes/2024/790.06"
      ]
    },
    {
      "when": { "ccw_applicant_age_bracket": "18-to-20-military-or-veteran" },
      "addItems": ["dd214-or-military-orders"],
      "note": "Servicemember / honorably-discharged veteran aged 18-20 qualifies. Present DD-214 (veteran) OR current military orders + statement of military service (active duty).",
      "sourceRefs": [
        "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Eligibility-Requirements"
      ]
    },
    {
      "when": { "is_us_citizen": "permanent-resident" },
      "addItems": ["lawful-presence-green-card"],
      "note": "Lawful permanent resident aliens qualify. Must present a valid Permanent Resident Alien card with the application.",
      "sourceRefs": [
        "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Eligibility-Requirements"
      ]
    },
    {
      "when": { "is_us_citizen": "temporary-lawful-presence" },
      "note": "BLOCKED: Florida CCW eligibility is limited to US citizens and lawful permanent resident aliens. Temporary lawful presence (visa holders, I-94, EAD) does NOT qualify.",
      "sourceRefs": [
        "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Eligibility-Requirements",
        "https://www.flsenate.gov/Laws/Statutes/2024/790.06"
      ]
    },
    {
      "when": { "ccw_has_training_document": "no" },
      "note": "BLOCKED: Florida law requires proof of firearms competency. Customer must first complete an approved course (NRA firearms safety, hunter safety/education course, law-enforcement firearms course, or state-certified instructor course) and obtain a certificate. Active-duty military / veterans can substitute DD-214 or call-to-active-duty orders.",
      "sourceRefs": [
        "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Acceptable-Firearms-Training-Documentation"
      ]
    },
    {
      "when": { "ccw_intent": "renewal" },
      "removeItems": ["ccw-firearms-training-document"],
      "addItems": ["existing-ccw-license"],
      "note": "Renewal does NOT require new training documentation. Bring the current CCW license.",
      "sourceRefs": ["https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License"]
    },
    {
      "when": { "recent_name_change": "yes-with-docs" },
      "addItems": ["name-change-marriage-cert"],
      "note": "Name change must be documented with a certified marriage certificate, divorce decree, or court order.",
      "sourceRefs": [
        "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [],
    "tcslcVerified": ["https://www.tcslc.com/331/Concealed-Weapon-Permits"],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/790.06",
      "https://www.flsenate.gov/Laws/Statutes/2024/790.0655"
    ]
  }
}
'::jsonb),
  ('dealer-title-dropoff', '{
  "txnTypeId": "dealer-title-dropoff",
  "baseItems": ["photo-id-all-applicants", "sunbiz-registration", "dealer-license-active"],
  "factsRequired": [
    "dealer_dropoff_type",
    "dealer_license_active",
    "dealer_has_odometer_disclosure",
    "dealer_dropoff_entity_type"
  ],
  "branches": [
    {
      "when": {
        "dealer_license_active": "no-expired"
      },
      "note": "BLOCKED: Your Florida motor-vehicle dealer license must be active. Renew with the FLHSMV Motor Vehicle Field Operations before dropping off title paperwork. See the Bureau of Field Operations Regional Offices directory (tcslc /DocumentCenter/View/167).",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/320.27",
        "https://www.tcslc.com/DocumentCenter/View/167"
      ]
    },
    {
      "when": {
        "dealer_dropoff_type": "title-bundle"
      },
      "addItems": [
        "original-vehicle-title",
        "bill-of-sale-purchase-agreement",
        "fl-insurance-proof"
      ],
      "note": "Standard dealer title-bundle drop-off \u2014 each vehicle''s packet needs: original properly-assigned title, bill of sale / retail purchase agreement, and Florida insurance proof. Follow the tcslc New Dealer Information Packet (DocumentCenter/View/1492) for the exact paperwork sequence.",
      "sourceRefs": [
        "https://www.tcslc.com/216/Dealers-Corner",
        "https://www.tcslc.com/DocumentCenter/View/1492",
        "https://www.flsenate.gov/Laws/Statutes/2024/319.23"
      ]
    },
    {
      "when": {
        "dealer_dropoff_type": "reassignment"
      },
      "addItems": ["hsmv-82091"],
      "note": "Reassignment Supplement (HSMV 82091) \u2014 used when the number of on-title reassignment lines is exhausted. Correct use per the ''Correct Use of Reassignments for Conforming Titles'' procedure (DocumentCenter/View/515).",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82091.pdf",
        "https://www.tcslc.com/216/Dealers-Corner"
      ]
    },
    {
      "when": {
        "dealer_dropoff_type": "temp-plate-stock"
      },
      "addItems": ["hsmv-83090", "hsmv-83091"],
      "note": "Temporary License Plate application. HSMV 83090 = Application by Florida Dealer for Temporary License Plates. HSMV 83091 = Application for Temporary License Plate for a single customer.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/83090.pdf",
        "https://www.flhsmv.gov/pdf/forms/83091.pdf"
      ]
    },
    {
      "when": {
        "dealer_dropoff_type": "towing-destruction"
      },
      "addItems": ["hsmv-82012"],
      "note": "Application for Towing and Storage Certification of Destruction (HSMV 82012). Include the Towing-and-Storage Certificate of Destruction Checklist (DocumentCenter/View/1477) for every record.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82012.pdf",
        "https://www.tcslc.com/DocumentCenter/View/1477"
      ]
    },
    {
      "when": {
        "dealer_dropoff_type": "out-of-business"
      },
      "addItems": ["hsmv-86060"],
      "note": "Statement of Intent to Relinquish a Dealer License (HSMV 86060) \u2014 dealer closing operations. File to surrender the dealer license and release remaining temporary-plate inventory.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/86060.pdf"]
    },
    {
      "when": {
        "dealer_has_odometer_disclosure": "no"
      },
      "addItems": ["hsmv-82993"],
      "note": "Separate Odometer Disclosure (HSMV 82993) \u2014 required when the title doesn''t contain the odometer-disclosure section or when reassignment forms are used. Model-year 2011 or newer requires disclosure at every transfer per \u00a7319.14.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82993.pdf",
        "https://www.flsenate.gov/Laws/Statutes/2024/319.14"
      ]
    },
    {
      "when": {
        "dealer_dropoff_entity_type": "individual"
      },
      "removeItems": ["sunbiz-registration"],
      "note": "Title transferring to an individual or co-individuals \u2014 no business entity proof needed. Sunbiz registration does not apply.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": {
        "dealer_dropoff_entity_type": "out-of-state-business"
      },
      "removeItems": ["sunbiz-registration"],
      "addItems": ["business-entity-proof"],
      "note": "Out-of-state businesses provide their FEID number or home-state registration; Florida Sunbiz isn''t applicable. FLHSMV accepts FEID, FL sales-tax registration number, or equivalent business-entity proof.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": {
        "dealer_dropoff_entity_type": "trust"
      },
      "removeItems": ["sunbiz-registration"],
      "addItems": ["trust-certification"],
      "note": "Title transferring into a trust \u2014 bring the trust certification or trust agreement showing the trustee''s authority. Sunbiz does not apply to trusts.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/pdf/forms/82091.pdf",
      "https://www.flhsmv.gov/pdf/forms/82012.pdf",
      "https://www.flhsmv.gov/pdf/forms/83090.pdf",
      "https://www.flhsmv.gov/pdf/forms/83091.pdf",
      "https://www.flhsmv.gov/pdf/forms/86060.pdf",
      "https://www.flhsmv.gov/pdf/forms/82993.pdf"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/216/Dealers-Corner",
      "https://www.tcslc.com/DocumentCenter/View/1492",
      "https://www.tcslc.com/DocumentCenter/View/168"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/319.23",
      "https://www.flsenate.gov/Laws/Statutes/2024/319.14",
      "https://www.flsenate.gov/Laws/Statutes/2024/320.27"
    ]
  }
}
'::jsonb),
  ('dl-address-change', '{
  "txnTypeId": "dl-address-change",
  "baseItems": ["fl-driver-license-to-renew", "address-proof-1", "address-proof-2"],
  "factsRequired": ["dl_renewal_channel", "real_id_status", "address_proof_count"],
  "branches": [
    {
      "when": {
        "dl_renewal_channel": "online-mydmv"
      },
      "addItems": ["mydmv-portal-referral"],
      "removeItems": ["fl-driver-license-to-renew", "address-proof-1", "address-proof-2"],
      "note": "Address change is supported online via MyDMV Portal. No proof of address is required for the online update \u2014 FLHSMV trusts the registered user''s attestation. Credential mailed within 2-3 weeks with the new address.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
        "https://mydmvportal.flhsmv.gov/"
      ]
    },
    {
      "when": {
        "real_id_status": "not-compliant"
      },
      "addItems": ["primary-id-passport", "social-security-card"],
      "note": "Customer is not REAL ID compliant \u2014 cannot update address online; must come in-office and present the full REAL ID document set (primary identity, SSN proof, two address proofs).",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"
      ]
    },
    {
      "when": {
        "address_proof_count": "zero"
      },
      "removeItems": ["address-proof-1", "address-proof-2"],
      "addItems": ["declaration-of-domicile"],
      "note": "No qualifying Florida-address documents \u2014 customer must obtain a notarized and recorded Declaration of Domicile at the St. Lucie County Clerk of Court''s Recording Department.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
        "https://stlucieclerk.gov/departments-top-menu/recording-department"
      ]
    },
    {
      "when": {
        "address_proof_count": "one"
      },
      "removeItems": ["address-proof-2"],
      "addItems": ["declaration-of-domicile"],
      "note": "Only one qualifying FL-address document \u2014 second must be supplied via Declaration of Domicile or another qualifying list-B document.",
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - Class E .xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/163/Driver-Licenses-Identification-Cards"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/322.19"],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR01.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf"
    ]
  }
}
'::jsonb),
  ('dl-name-change', '{
  "txnTypeId": "dl-name-change",
  "baseItems": ["fl-driver-license-to-renew", "ssa-record-updated", "name-change-marriage-cert"],
  "factsRequired": [
    "real_id_status",
    "is_us_citizen",
    "has_primary_id",
    "has_social_security_card",
    "address_proof_count",
    "recent_name_change",
    "name_change_document_type",
    "ssa_record_updated",
    "recent_address_change"
  ],
  "branches": [
    {
      "when": {
        "ssa_record_updated": "no"
      },
      "note": "BLOCKED: Customer must update their name with the Social Security Administration BEFORE the Florida credential can be changed. FLHSMV requires SSA record reflecting the new name; without this, the issuance will fail the SSN/name match check.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "recent_name_change": "yes-missing-docs"
      },
      "note": "BLOCKED: Customer does not have the certified name-change documentation in hand. Florida requires an original or certified court order of marriage certificate, divorce decree, or court-ordered name change.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "name_change_document_type": "divorce-decree"
      },
      "removeItems": ["name-change-marriage-cert"],
      "addItems": ["name-change-divorce-decree"],
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "name_change_document_type": "court-order"
      },
      "removeItems": ["name-change-marriage-cert"],
      "addItems": ["name-change-court-order"],
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "real_id_status": "not-compliant"
      },
      "addItems": [
        "primary-id-passport",
        "social-security-card",
        "address-proof-1",
        "address-proof-2"
      ],
      "note": "Name change combined with first-time REAL ID upgrade \u2014 customer must present the full REAL ID document set along with the certified name-change documentation.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"
      ]
    },
    {
      "when": {
        "recent_address_change": "yes",
        "address_proof_count": "zero"
      },
      "addItems": ["declaration-of-domicile"],
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
        "https://stlucieclerk.gov/departments-top-menu/recording-department"
      ]
    },
    {
      "when": {
        "recent_address_change": "yes",
        "address_proof_count": "one"
      },
      "addItems": ["declaration-of-domicile"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - Class E .xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/163/Driver-Licenses-Identification-Cards",
      "https://www.tcslc.com/315/Driver-License-IDs"
    ],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/322.19"],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR12.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf"
    ]
  }
}
'::jsonb),
  ('dl-renewal', '{
  "txnTypeId": "dl-renewal",
  "baseItems": ["fl-driver-license-to-renew"],
  "factsRequired": [
    "dl_renewal_channel",
    "real_id_status",
    "is_us_citizen",
    "has_primary_id",
    "has_social_security_card",
    "address_proof_count",
    "recent_name_change",
    "recent_address_change",
    "wears_corrective_lenses",
    "is_veteran_designation_request",
    "is_100_percent_disabled_veteran"
  ],
  "branches": [
    {
      "when": {
        "dl_renewal_channel": "online-mydmv"
      },
      "addItems": ["mydmv-portal-referral"],
      "removeItems": ["fl-driver-license-to-renew"],
      "note": "Customer is eligible for MyDMV online renewal \u2014 no in-office visit needed. Credential mailed within 2-3 weeks. $2 processing fee applies on top of standard renewal fee.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
        "https://mydmvportal.flhsmv.gov/"
      ]
    },
    {
      "when": {
        "real_id_status": "not-compliant"
      },
      "addItems": [
        "primary-id-passport",
        "social-security-card",
        "address-proof-1",
        "address-proof-2"
      ],
      "note": "Customer is not yet REAL ID compliant. FLHSMV requires the full REAL ID document set on this renewal: one primary identity document, proof of SSN, and two proofs of residential address.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"
      ]
    },
    {
      "when": {
        "has_primary_id": "birth-certificate"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-birth-certificate"],
      "note": "Customer using certified birth certificate instead of passport as the primary identity document.",
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "naturalization-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-naturalization-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "citizenship-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-citizenship-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "consular-report"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-consular-report"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "is_us_citizen": "permanent-resident"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-green-card"],
      "note": "Non-citizen renewals: lawful-presence document (green card) replaces the US primary identity document.",
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/"]
    },
    {
      "when": {
        "is_us_citizen": "temporary-lawful-presence"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-visa-i94"],
      "note": "Temporary lawful-presence customers renew with their current I-94 / visa; the Florida credential will expire with the I-94.",
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/"]
    },
    {
      "when": {
        "recent_name_change": "yes-with-docs"
      },
      "addItems": ["name-change-marriage-cert"],
      "note": "Name change via marriage \u2014 customer must present the original or certified marriage certificate AND have already updated their name with the Social Security Administration.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "recent_name_change": "yes-missing-docs"
      },
      "note": "BLOCKED: Customer reports a name change but does not have the certified documentation. Customer must obtain certified marriage certificate, divorce decree, or court order AND update their record with the Social Security Administration BEFORE we can update the credential.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "recent_address_change": "yes"
      },
      "note": "Customer has an address change since the last credential; this is supported on the same visit as long as two Florida residential-address documents are presented.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "address_proof_count": "zero"
      },
      "addItems": ["declaration-of-domicile"],
      "note": "No qualifying Florida-address documents \u2014 customer must fill out, notarize, and record a Declaration of Domicile at the St. Lucie County Clerk of Court''s Recording Department BEFORE the visit.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
        "https://stlucieclerk.gov/departments-top-menu/recording-department"
      ]
    },
    {
      "when": {
        "address_proof_count": "one"
      },
      "addItems": ["declaration-of-domicile"],
      "note": "Only one qualifying Florida-address document \u2014 the second must be supplied via Declaration of Domicile or another qualifying list-B document.",
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "wears_corrective_lenses": "yes-not-with-me"
      },
      "addItems": ["vision-test-or-dl10"],
      "note": "Customer normally wears corrective lenses but does not have them on this visit. Either return with lenses or present HSMV 72010 (Report of Eye Exam) completed by an eye doctor.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/72010.pdf"]
    },
    {
      "when": {
        "is_veteran_designation_request": "yes"
      },
      "addItems": ["dd214-or-veteran-id"],
      "note": "Veteran designation: customer must present DD-214, VA card, or other federal proof of honorable discharge to add the V designation to the credential.",
      "sourceRefs": ["https://www.flhsmv.gov/military/"]
    },
    {
      "when": {
        "is_100_percent_disabled_veteran": "yes"
      },
      "addItems": ["va-100-percent-disability-letter"],
      "note": "Veterans with a VA-documented 100% total and permanent service-connected disability rating may be eligible for a no-fee driver license or ID card per \u00a7322.21(1). Customer must present VA letter showing 100% T&P rating.",
      "sourceRefs": [
        "https://www.flhsmv.gov/military/",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.21"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - Class E .xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/",
      "https://www.flhsmv.gov/military/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/163/Driver-Licenses-Identification-Cards",
      "https://www.tcslc.com/315/Driver-License-IDs"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/322.18",
      "https://www.flsenate.gov/Laws/Statutes/2024/322.21"
    ],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/EO02.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR01.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR15.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR17.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR20.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP11.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP18.pdf"
    ]
  }
}
'::jsonb),
  ('dl-replacement', '{
  "txnTypeId": "dl-replacement",
  "baseItems": ["primary-id-passport"],
  "factsRequired": [
    "dl_renewal_channel",
    "real_id_status",
    "is_us_citizen",
    "has_primary_id",
    "has_social_security_card",
    "address_proof_count",
    "recent_name_change",
    "recent_address_change",
    "is_veteran_designation_request",
    "is_100_percent_disabled_veteran"
  ],
  "branches": [
    {
      "when": {
        "dl_renewal_channel": "online-mydmv",
        "real_id_status": "compliant"
      },
      "addItems": ["mydmv-portal-referral"],
      "removeItems": ["primary-id-passport"],
      "note": "REAL-ID-compliant customers can replace a lost or stolen credential online at MyDMV Portal. Credential mailed within 2-3 weeks. $2 online processing fee applies in addition to the replacement fee.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
        "https://mydmvportal.flhsmv.gov/"
      ]
    },
    {
      "when": {
        "real_id_status": "not-compliant"
      },
      "addItems": ["social-security-card", "address-proof-1", "address-proof-2"],
      "note": "Customer is not REAL ID compliant; replacement must be done in-office with the full REAL ID document set (primary identity + SSN proof + two residential-address documents).",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"
      ]
    },
    {
      "when": {
        "has_primary_id": "birth-certificate"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-birth-certificate"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "naturalization-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-naturalization-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "citizenship-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-citizenship-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "consular-report"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-consular-report"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "is_us_citizen": "permanent-resident"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-green-card"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/"]
    },
    {
      "when": {
        "is_us_citizen": "temporary-lawful-presence"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-visa-i94"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/"]
    },
    {
      "when": {
        "recent_name_change": "yes-with-docs"
      },
      "addItems": ["name-change-marriage-cert"],
      "note": "Name change accompanying the replacement requires the certified marriage certificate or court order, AND the Social Security Administration record must already reflect the new name.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "recent_name_change": "yes-missing-docs"
      },
      "note": "BLOCKED: customer must obtain certified name-change documentation and update the SSA record before the credential can be re-issued with the new name.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "recent_address_change": "yes",
        "address_proof_count": "zero"
      },
      "addItems": ["declaration-of-domicile"],
      "note": "Address change with no qualifying FL-address documents \u2014 customer must obtain a Declaration of Domicile (notarized, recorded at Clerk''s Recording Department).",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
        "https://stlucieclerk.gov/departments-top-menu/recording-department"
      ]
    },
    {
      "when": {
        "recent_address_change": "yes",
        "address_proof_count": "one"
      },
      "addItems": ["declaration-of-domicile"],
      "note": "Only one qualifying FL-address document \u2014 the second must be supplied via Declaration of Domicile or another qualifying list-B document.",
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "is_veteran_designation_request": "yes"
      },
      "addItems": ["dd214-or-veteran-id"],
      "sourceRefs": ["https://www.flhsmv.gov/military/"]
    },
    {
      "when": {
        "is_100_percent_disabled_veteran": "yes"
      },
      "addItems": ["va-100-percent-disability-letter"],
      "note": "Per \u00a7322.21(1), 100% T&P disabled veterans qualify for a no-fee replacement credential.",
      "sourceRefs": [
        "https://www.flhsmv.gov/military/",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.21"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - Class E .xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/",
      "https://www.flhsmv.gov/military/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/163/Driver-Licenses-Identification-Cards",
      "https://www.tcslc.com/315/Driver-License-IDs"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/322.17",
      "https://www.flsenate.gov/Laws/Statutes/2024/322.21"
    ],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/EO02.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR15.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR17.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf"
    ]
  }
}
'::jsonb),
  ('dl-sanctions-lift', '{
  "txnTypeId": "dl-sanctions-lift",
  "baseItems": ["photo-id-all-applicants", "reinstatement-fee"],
  "factsRequired": [
    "sanction_type",
    "sanction_status",
    "has_cleared_underlying_issue",
    "has_completed_required_course",
    "has_sr22_insurance",
    "has_dui_iid_requirement",
    "wants_hardship_license"
  ],
  "branches": [
    {
      "when": {
        "sanction_type": "traffic-citation-unpaid",
        "has_cleared_underlying_issue": "no-still-owed"
      },
      "note": "BLOCKED: Suspension for unpaid traffic citation is indefinite. You must first contact the traffic court in the county where the citation was issued and pay the fine; some courts accept online credit-card payment. The court will update FLHSMV electronically with the clearance. Only then can we process reinstatement.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/traffic-citations-court-suspensions/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06C.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "traffic-citation-unpaid",
        "has_cleared_underlying_issue": "yes"
      },
      "note": "Court has cleared the underlying citation \u2014 present the reinstatement fee at any driver license service center OR pay by phone (850-617-3000). Check status at MyDMV Portal Online Driver License Check.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/traffic-citations-court-suspensions/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06C.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "failure-to-appear",
        "has_cleared_underlying_issue": "no-still-owed"
      },
      "note": "BLOCKED: Failure-to-comply / failure-to-appear suspensions are indefinite. You must contact the traffic court in the issuing county and satisfy the court requirements. The county will electronically update FLHSMV with clearance. These suspensions are NOT eligible for hardship license.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/traffic-citations-court-suspensions/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06C.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "failure-to-complete-driver-school",
        "has_cleared_underlying_issue": "no-still-owed"
      },
      "note": "BLOCKED: Suspension for failing to complete a court-ordered driver improvement school. Contact the traffic court in the county where the summons was issued and satisfy the court''s requirements; the court will update FLHSMV electronically with clearance before the reinstatement fee can be paid.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/traffic-citations-court-suspensions/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06C.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "child-support"
      },
      "note": "BLOCKED: Child-support-delinquency suspensions are indefinite AND not eligible for a hardship license. Contact the Florida Department of Revenue (850-488-5437, floridarevenue.com) to resolve. Once the delinquency is cleared, FLHSMV is notified electronically; then present the reinstatement fee at any driver license service center.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/other-suspensions-revocations/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06C.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "points",
        "sanction_status": "current-suspension"
      },
      "note": "Point-based suspension \u2014 the period depends on total points accumulated (per \u00a7322.27 point schedule). After the suspension period has run, present the reinstatement fee for full restoration. Hardship license may be available earlier via the Administrative Reviews Office.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/points-point-suspensions/",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.28",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06C.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "financial-responsibility",
        "has_sr22_insurance": "no"
      },
      "addItems": ["sr22-filing-from-insurer"],
      "note": "Financial-responsibility suspension (PIP/insurance-related) requires an SR-22 insurance filing from an authorized insurer, filed directly with FLHSMV. Customer obtains the SR-22 from their insurance company (not at the tax collector).",
      "sourceRefs": [
        "https://www.flhsmv.gov/insurance/received-a-letter/",
        "https://www.flsenate.gov/Laws/Statutes/2024/627.733",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06E.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "financial-responsibility",
        "has_sr22_insurance": "yes-on-file"
      },
      "note": "SR-22 is on file \u2014 present the reinstatement fee at any driver license service center. FR suspensions may also require any tags to be surrendered if the vehicle is no longer insured.",
      "sourceRefs": [
        "https://www.flhsmv.gov/insurance/received-a-letter/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06E.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "dui",
        "wants_hardship_license": "yes"
      },
      "addItems": [
        "licensed-dui-program-completion",
        "hardship-license-application",
        "adi-course-completion"
      ],
      "note": "DUI hardship license \u2014 after the mandatory revocation minimum (varies by DUI conviction under \u00a7322.28), apply through your local Administrative Reviews Office with: Licensed DUI Program completion, ADI completion, reinstatement fee. Hardship license restricts driving to employment or business purposes only.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/education-courses/dui-and-iid/",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.28",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.291",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06D.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "dui",
        "has_dui_iid_requirement": "yes-iid-active"
      },
      "addItems": ["iid-installation-proof"],
      "note": "Ignition Interlock Device (IID) required per \u00a7322.2715. Proof of IID installation from an FLHSMV-contracted provider must accompany the reinstatement. Violations reviewed by the FLHSMV Bureau of Motorist Compliance.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/education-courses/dui-and-iid/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06D.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "dui",
        "wants_hardship_license": "no",
        "sanction_status": "current-revocation"
      },
      "addItems": ["licensed-dui-program-completion", "adi-course-completion"],
      "note": "Full DUI reinstatement (revocation period fully served) \u2014 present Licensed DUI Program completion, ADI course enrollment, and reinstatement fee. Additional license fees may also apply.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/education-courses/dui-and-iid/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06D.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "habitual-traffic-offender",
        "sanction_status": "current-revocation",
        "wants_hardship_license": "yes"
      },
      "addItems": ["adi-course-completion", "hardship-license-application"],
      "note": "Habitual Traffic Offender (HTO) \u2014 license is revoked for 5 years (\u00a7322.34). After one year from the effective date, customer may apply for hardship through the Administrative Reviews Office with ADI completion + reinstatement fee. Hardship license is employment-only.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/other-suspensions-revocations/",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.34",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06D.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "habitual-traffic-offender",
        "sanction_status": "expired-but-not-reinstated"
      },
      "addItems": ["adi-course-completion"],
      "note": "HTO revocation period has expired \u2014 full reinstatement requires ADI school enrollment + reinstatement fee + any applicable license fees at any driver license service center.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/other-suspensions-revocations/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06D.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "drug-offense-chapter-893",
        "wants_hardship_license": "yes"
      },
      "addItems": ["licensed-dui-program-completion", "hardship-license-application"],
      "note": "Chapter 893 drug-offense suspension (minimum 1 year). After 6 months from the effective date, customer may apply for hardship through the Administrative Reviews Office with Licensed DUI Program completion + reinstatement fee. Hardship license is employment-only.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/other-suspensions-revocations/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06D.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "medical-vision",
        "has_cleared_underlying_issue": "no-still-owed"
      },
      "addItems": ["medical-vision-clearance"],
      "note": "Medical or vision suspension \u2014 customer must work through FLHSMV''s Medical Review process (HSMV 72010 eye-exam report or Medical Advisory Board evaluation). Reinstatement requires the medical clearance before any fee is accepted.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/general-information/medical-visual-problems/",
        "https://www.flhsmv.gov/driver-licenses-id-cards/medical-review/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI08.pdf"
      ]
    },
    {
      "when": {
        "sanction_type": "non-dui-death-or-serious-injury",
        "wants_hardship_license": "yes"
      },
      "addItems": ["adi-course-completion", "hardship-license-application"],
      "note": "Non-DUI violation resulting in death or serious bodily injury \u2014 license is suspended up to 1 year. Hardship license available through Administrative Reviews Office with ADI completion + reinstatement fee. Hardship license is employment-only.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/other-suspensions-revocations/",
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06C.pdf"
      ]
    },
    {
      "when": {
        "has_completed_required_course": "no-not-yet"
      },
      "note": "Reinstatement likely blocked on course completion. Advanced Driver Improvement (ADI) is required for HTO, non-DUI-serious-injury, and DUI hardship paths. Licensed DUI Program is required for DUI and Chapter 893 drug paths. See the FLHSMV suspensions/revocations pages for approved-provider links.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/other-suspensions-revocations/",
        "https://www.flhsmv.gov/driver-licenses-id-cards/education-courses/dui-and-iid/"
      ]
    },
    {
      "when": {
        "sanction_status": "expired-but-not-reinstated",
        "has_cleared_underlying_issue": "yes"
      },
      "note": "Per CI06 \u00a715-year policy: if your open Florida sanction is more than 15 years old AND you have been continuously licensed by another state after the sanction''s effective date, reinstatement fees and compliance requirements may be waived. Request an Administrative Reviews determination.",
      "sourceRefs": [
        "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06.pdf",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.28"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/other-suspensions-revocations/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/points-point-suspensions/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/traffic-citations-court-suspensions/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/education-courses/dui-and-iid/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/general-information/medical-visual-problems/",
      "https://www.flhsmv.gov/insurance/received-a-letter/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/163/Driver-Licenses-Identification-Cards"],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/322.28",
      "https://www.flsenate.gov/Laws/Statutes/2024/322.2615",
      "https://www.flsenate.gov/Laws/Statutes/2024/322.291",
      "https://www.flsenate.gov/Laws/Statutes/2024/322.34"
    ],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06A.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06B.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06C.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06D.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI06E.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI08.pdf"
    ]
  }
}
'::jsonb),
  ('dl-transfer', '{
  "txnTypeId": "dl-transfer",
  "baseItems": [
    "primary-id-passport",
    "social-security-card",
    "address-proof-1",
    "address-proof-2",
    "oos-license"
  ],
  "factsRequired": [
    "is_us_citizen",
    "has_primary_id",
    "has_social_security_card",
    "address_proof_count",
    "recent_name_change",
    "is_new_fl_resident",
    "oos_license_status",
    "came_from_type",
    "lawful_presence_docs",
    "wears_corrective_lenses",
    "is_military_active_duty"
  ],
  "branches": [
    {
      "when": {
        "has_primary_id": "birth-certificate"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-birth-certificate"],
      "note": "Customer is using certified birth certificate instead of passport as primary ID."
    },
    {
      "when": {
        "has_primary_id": "naturalization-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-naturalization-cert"]
    },
    {
      "when": {
        "has_primary_id": "citizenship-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-citizenship-cert"]
    },
    {
      "when": {
        "has_primary_id": "consular-report"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-consular-report"]
    },
    {
      "when": {
        "is_us_citizen": "permanent-resident"
      },
      "addItems": ["lawful-presence-green-card"],
      "removeItems": ["primary-id-passport"],
      "note": "Non-citizen path: lawful-presence document replaces the US primary identity document for REAL ID."
    },
    {
      "when": {
        "is_us_citizen": "temporary-lawful-presence"
      },
      "addItems": ["lawful-presence-visa-i94"],
      "removeItems": ["primary-id-passport"],
      "note": "Temporary lawful-presence applicants receive a DL that expires with their I-94."
    },
    {
      "when": {
        "address_proof_count": "zero"
      },
      "addItems": ["declaration-of-domicile"],
      "removeItems": ["address-proof-1", "address-proof-2"],
      "note": "No qualifying address docs \u2014 customer must obtain Declaration of Domicile from the St. Lucie Clerk of Courts."
    },
    {
      "when": {
        "address_proof_count": "one"
      },
      "removeItems": ["address-proof-2"],
      "addItems": ["declaration-of-domicile"],
      "note": "One address doc held, second must be supplied via Declaration of Domicile or another qualifying list-B document."
    },
    {
      "when": {
        "recent_name_change": "yes-with-docs"
      },
      "addItems": ["name-change-marriage-cert"],
      "note": "Customer indicated marriage-based name change; any certified name-change document (marriage/divorce/court order) is acceptable \u2014 this item is the default instance. Swap for divorce decree or court order if that applies."
    },
    {
      "when": {
        "recent_name_change": "yes-missing-docs"
      },
      "addItems": ["name-change-court-order"],
      "note": "Customer must acquire certified name-change paperwork before the visit."
    },
    {
      "when": {
        "oos_license_status": "never-held"
      },
      "removeItems": ["oos-license"],
      "note": "First-time driver applying for FL license does not bring an OOS license."
    },
    {
      "when": {
        "oos_license_status": "expired-more-than-1yr"
      },
      "addItems": ["certified-driving-record"],
      "note": "Expired >1yr or not verifiable in NLETS requires certified driving record."
    },
    {
      "when": {
        "wears_corrective_lenses": "yes-not-with-me"
      },
      "addItems": ["vision-test-or-dl10"],
      "note": "Customer cannot take vision test today; must return with lenses or provide HSMV 72010 completed by eye doctor."
    },
    {
      "when": {
        "is_military_active_duty": "yes"
      },
      "addItems": ["military-orders"],
      "note": "Active-duty military orders can substitute for address documents; copy of orders required."
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - Immigration.xlsx, Driver License - Class E .xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/",
      "https://www.flhsmv.gov/new-resident/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/163/Driver-Licenses-Identification-Cards"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/322.031"],
    "gpt": ["Driver License - Immigration - GPT Reviewed.xlsx"],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR01.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR09.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR15.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR20.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR12.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/AcceptableDocuments.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP15.pdf"
    ]
  }
}
'::jsonb),
  ('duplicate-title', '{
  "txnTypeId": "duplicate-title",
  "baseItems": ["photo-id-all-applicants", "hsmv-82101"],
  "factsRequired": [
    "duplicate_title_channel",
    "title_holding_status",
    "has_lien_or_lease",
    "owners_joined",
    "signing_via_poa"
  ],
  "branches": [
    {
      "when": { "duplicate_title_channel": "online-mydmv", "has_lien_or_lease": "none" },
      "addItems": ["mydmv-portal-referral"],
      "removeItems": ["photo-id-all-applicants", "hsmv-82101"],
      "note": "Electronic titles with no lien can be converted to paper online at MyDMV Portal for a $4.50 fee. Paper title mailed to the address on the motor vehicle record within 3-4 weeks.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/paper-liens-and-titles/",
        "https://mydmvportal.flhsmv.gov/"
      ]
    },
    {
      "when": { "has_lien_or_lease": "lien-active" },
      "addItems": ["lien-letter"],
      "note": "Active lien on the vehicle — duplicate title typically issued to the lienholder, not the customer. Lienholder may need to provide a release or letter authorizing a duplicate to the registered owner.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/paper-liens-and-titles/"
      ]
    },
    {
      "when": { "owners_joined": "joined-and" },
      "note": "Title with multiple owners joined by ''and'' — all owners must sign the duplicate title application (HSMV 82101).",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/82101.pdf"]
    },
    {
      "when": { "signing_via_poa": "yes-owner-absent" },
      "addItems": ["hsmv-82053"],
      "note": "Owner cannot be present — notarized POA (HSMV 82053) required authorizing the third party to apply for the duplicate title.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/82053.pdf"]
    },
    {
      "when": { "title_holding_status": "electronic-held", "duplicate_title_channel": "in-office" },
      "note": "Electronic title currently held in FLHSMV''s database — customer can convert to paper at the office for the standard fee. Paper title mailed to the address on record.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/paper-liens-and-titles/"
      ]
    },
    {
      "when": { "title_holding_status": "lost-paper" },
      "note": "Lost or destroyed paper title — HSMV 82101 duplicate title application; the customer''s most recent title record is reissued as a new paper title.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/82101.pdf"]
    }
  ],
  "sources": {
    "spreadsheet": "FL Titles- MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/paper-liens-and-titles/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/198/Duplicate-Titles",
      "https://www.tcslc.com/194/Titles-Registrations"
    ],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/319.23"]
  }
}
'::jsonb),
  ('handicap-placard', '{
  "txnTypeId": "handicap-placard",
  "baseItems": [],
  "factsRequired": [
    "placard_scenario",
    "placard_applicant_type",
    "placard_physician_cert_age_months",
    "placard_duration",
    "placard_qualifying_condition",
    "placard_certifier_type",
    "placard_replacement_reason",
    "placard_has_police_report",
    "placard_special_exception_needed",
    "placard_visitor_has_isa",
    "placard_prior_temporary_within_12mo",
    "placard_additional_permit_type",
    "placard_org_id_type",
    "placard_minor_or_guardian_signing",
    "placard_country_of_origin_for_visitor"
  ],
  "branches": [
    {
      "when": { "placard_physician_cert_age_months": "more-than-12" },
      "blocking": {
        "severity": "hard",
        "reason": "expired-physician-certification",
        "customerMessage": "The physician''s signature on HSMV 83039 must be dated within the last 12 months. Florida cannot accept a certification older than that.",
        "nextSteps": "Ask your physician (or another qualifying medical professional) for a fresh certification on HSMV 83039 and come back. The form is at flhsmv.gov/pdf/forms/83039.pdf.",
        "sourceRefs": [
          "https://www.flhsmv.gov/pdf/forms/83039.pdf",
          "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/"
        ]
      },
      "note": "BLOCKED: HSMV 83039 medical certification is more than 12 months old."
    },
    {
      "when": {
        "placard_certifier_type": "optometrist-sight-only",
        "placard_qualifying_condition": "cant-walk-200ft"
      },
      "blocking": {
        "severity": "hard",
        "reason": "optometrist-out-of-scope",
        "customerMessage": "An optometrist''s certification can only support legal blindness or sight-related disability. For another condition, please ask a physician (MD/DO), physician assistant, chiropractor, podiatrist, or APRN to sign HSMV 83039 instead.",
        "nextSteps": "Bring HSMV 83039 to a qualifying medical professional whose scope of practice covers your condition.",
        "sourceRefs": [
          "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
          "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/"
        ]
      },
      "note": "BLOCKED: optometrist certifying a non-sight condition (cant-walk-200ft)."
    },
    {
      "when": {
        "placard_certifier_type": "optometrist-sight-only",
        "placard_qualifying_condition": "wheelchair"
      },
      "blocking": {
        "severity": "hard",
        "reason": "optometrist-out-of-scope",
        "customerMessage": "An optometrist''s certification can only support legal blindness or sight-related disability. For wheelchair use or another non-sight condition, please ask a physician (MD/DO), physician assistant, chiropractor, podiatrist, or APRN to sign HSMV 83039 instead.",
        "nextSteps": "Bring HSMV 83039 to a qualifying medical professional whose scope of practice covers your condition.",
        "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
      },
      "note": "BLOCKED: optometrist certifying wheelchair use."
    },
    {
      "when": {
        "placard_certifier_type": "optometrist-sight-only",
        "placard_qualifying_condition": "lung-fev1-under-1l"
      },
      "blocking": {
        "severity": "hard",
        "reason": "optometrist-out-of-scope",
        "customerMessage": "An optometrist''s certification can only support legal blindness or sight-related disability. For lung disease, please ask a physician (MD/DO), physician assistant, or APRN to sign HSMV 83039 instead.",
        "nextSteps": "Bring HSMV 83039 to a qualifying medical professional whose scope of practice covers your condition.",
        "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
      },
      "note": "BLOCKED: optometrist certifying lung condition."
    },
    {
      "when": {
        "placard_certifier_type": "optometrist-sight-only",
        "placard_qualifying_condition": "portable-oxygen"
      },
      "blocking": {
        "severity": "hard",
        "reason": "optometrist-out-of-scope",
        "customerMessage": "An optometrist''s certification can only support legal blindness or sight-related disability. For oxygen dependence, please ask a physician (MD/DO), physician assistant, or APRN to sign HSMV 83039 instead.",
        "nextSteps": "Bring HSMV 83039 to a qualifying medical professional whose scope of practice covers your condition.",
        "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
      },
      "note": "BLOCKED: optometrist certifying oxygen dependence."
    },
    {
      "when": {
        "placard_certifier_type": "optometrist-sight-only",
        "placard_qualifying_condition": "nyha-3-or-4"
      },
      "blocking": {
        "severity": "hard",
        "reason": "optometrist-out-of-scope",
        "customerMessage": "An optometrist''s certification can only support legal blindness or sight-related disability. For a cardiac condition, please ask a physician (MD/DO), physician assistant, or APRN to sign HSMV 83039 instead.",
        "nextSteps": "Bring HSMV 83039 to a qualifying medical professional whose scope of practice covers your condition.",
        "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
      },
      "note": "BLOCKED: optometrist certifying cardiac condition."
    },
    {
      "when": {
        "placard_certifier_type": "optometrist-sight-only",
        "placard_qualifying_condition": "severe-arthritic-neuro-orthopedic"
      },
      "blocking": {
        "severity": "hard",
        "reason": "optometrist-out-of-scope",
        "customerMessage": "An optometrist''s certification can only support legal blindness or sight-related disability. For an arthritic, neurological, or orthopedic condition, please ask a physician (MD/DO), physician assistant, chiropractor, podiatrist, or APRN to sign HSMV 83039 instead.",
        "nextSteps": "Bring HSMV 83039 to a qualifying medical professional whose scope of practice covers your condition.",
        "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
      },
      "note": "BLOCKED: optometrist certifying arthritic/neuro/orthopedic condition."
    },
    {
      "when": { "placard_certifier_type": "out-of-state-md" },
      "blocking": {
        "severity": "hard",
        "reason": "out-of-state-md-no-statement",
        "customerMessage": "An out-of-state physician must include a separate signed statement showing they understand Florida''s eligibility rules, plus documentation of their licensure. Without that, the certification can''t be accepted.",
        "nextSteps": "Either ask the out-of-state physician to attach a signed FL-eligibility statement and licensure copy, or have a Florida-licensed certifier sign HSMV 83039.",
        "sourceRefs": [
          "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
          "https://www.flhsmv.gov/pdf/forms/83039.pdf"
        ]
      },
      "note": "BLOCKED: out-of-state physician without separate FL-eligibility statement."
    },
    {
      "when": {
        "placard_applicant_type": "individual-florida-id",
        "placard_special_exception_needed": "yes",
        "placard_duration": "permanent"
      },
      "addItems": ["hsmv-83039"],
      "note": "Special Exception (homebound) path: the certifying physician signs the Special Exception line on HSMV 83039 in addition to the regular medical certification. With this, the FL DL/ID requirement is waived and the placard is issued without a DL number affixed. Submission options: by mail (TCSLC, P.O. Box 308, Ft. Pierce, FL 34954) or have the physician''s office fax HSMV 83039 directly to TCSLC. The applicant does not need to come in person.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/83039.pdf",
        "https://www.tcslc.com/218/Handicap-Placards"
      ]
    },
    {
      "when": {
        "placard_scenario": "original",
        "placard_duration": "permanent",
        "placard_applicant_type": "individual-florida-id",
        "placard_special_exception_needed": "no"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83039"],
      "note": "Permanent placard for a Florida resident — valid 4 years, no fee. Expires on the holder''s birthday. Submission options: in person at TCSLC (appointment Mon–Fri 9:00–14:00; walk-ins after 14:30), by mail (TCSLC, P.O. Box 308, Ft. Pierce, FL 34954), or have your physician''s office fax HSMV 83039 directly to TCSLC.",
      "sourceRefs": [
        "https://www.tcslc.com/218/Handicap-Placards",
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/permanent-disabled-person-parking-permits/"
      ]
    },
    {
      "when": {
        "placard_scenario": "original",
        "placard_duration": "temporary",
        "placard_applicant_type": "individual-florida-id",
        "placard_prior_temporary_within_12mo": "no"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83039", "payment-15-original-temporary"],
      "note": "Temporary placard for a Florida resident — valid up to 6 months (date set by the physician), $15. Submission options: in person, by mail (P.O. Box 308, Ft. Pierce, FL 34954), or physician-faxed HSMV 83039.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/temporary-disabled-person-parking-permits/",
        "https://www.flsenate.gov/Laws/Statutes/2024/320.0848"
      ]
    },
    {
      "when": {
        "placard_scenario": "original",
        "placard_duration": "temporary",
        "placard_applicant_type": "individual-florida-id",
        "placard_prior_temporary_within_12mo": "yes"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83039"],
      "note": "Second temporary placard within 12 months of the prior one — fee waived per §320.0848(1)(a). Submission options: in person, by mail, or physician-faxed.",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
        "https://www.flhsmv.gov/pdf/forms/83039.pdf"
      ]
    },
    {
      "when": {
        "placard_scenario": "original",
        "placard_applicant_type": "individual-out-of-state",
        "placard_visitor_has_isa": "yes"
      },
      "note": "Florida already honors your home placard if it displays the international wheelchair symbol — no Florida permit is needed. Display your home placard normally while parking in Florida. (No application, no fee, nothing to bring in.)",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/disabled-person-parking-permits-for-florida-visitors/",
        "https://www.flsenate.gov/Laws/Statutes/2024/316.1958"
      ]
    },
    {
      "when": {
        "placard_scenario": "original",
        "placard_applicant_type": "individual-out-of-state",
        "placard_visitor_has_isa": "no"
      },
      "addItems": ["visitor-acceptable-photo-id", "hsmv-83039", "payment-15-visitor-temporary"],
      "note": "Visitor temporary placard — $15, non-renewable. Apply in person at TCSLC, or by mail (P.O. Box 308, Ft. Pierce, FL 34954). Visitor temporaries cannot be renewed; if you''ll be in Florida longer than the placard''s validity, you''ll need to re-apply.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/disabled-person-parking-permits-for-florida-visitors/"
      ]
    },
    {
      "when": {
        "placard_scenario": "original",
        "placard_applicant_type": "individual-out-of-country"
      },
      "addItems": [
        "visitor-acceptable-photo-id",
        "home-country-permit-copy",
        "payment-15-visitor-temporary"
      ],
      "note": "Out-of-country visitor — you may submit a copy of your current home-country parking permit in lieu of HSMV 83039''s medical certification. $15, non-renewable. Submit in person or by mail.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/disabled-person-parking-permits-for-florida-visitors/"
      ]
    },
    {
      "when": {
        "placard_scenario": "original",
        "placard_applicant_type": "organization"
      },
      "addItems": ["org-feid-or-fl-sales-tax", "hsmv-83039"],
      "note": "Organization applicant — complete the ''Application by an Organization'' section on HSMV 83039. One placard per fleet vehicle registered to the organization, valid up to 4 years, expiring June 30. Identifier: FEID OR Florida sales-tax registration number. Submit in person or by mail (P.O. Box 308, Ft. Pierce, FL 34954).",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/organizations/"
      ]
    },
    {
      "when": {
        "placard_scenario": "renewal",
        "placard_applicant_type": "individual-florida-id",
        "placard_certifier_type": "va-letter-27-333"
      },
      "addItems": [
        "florida-dl-or-id",
        "va-form-letter-27-333",
        "expiring-placard-registration-copy"
      ],
      "removeItems": ["hsmv-83039"],
      "note": "Renewal with VA service-connected disability — VA Form Letter 27-333 (issued in the last 12 months) substitutes for the HSMV 83039 medical certification. Submission options: in person, by mail, by fax from the VA office, or online via MyDMVPortal.flhsmv.gov.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/permanent-disabled-person-parking-permits/",
        "https://www.flhsmv.gov/pdf/forms/83039.pdf"
      ]
    },
    {
      "when": {
        "placard_scenario": "renewal",
        "placard_applicant_type": "individual-florida-id"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83039", "expiring-placard-registration-copy"],
      "note": "Renewal — submit a new HSMV 83039 (signed within the last 12 months) plus a copy of the registration for your expiring permit. Submission options: in person, by mail, by fax from your physician''s office, or online via MyDMVPortal.flhsmv.gov.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/83039.pdf",
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/permanent-disabled-person-parking-permits/"
      ]
    },
    {
      "when": {
        "placard_scenario": "renewal",
        "placard_applicant_type": "organization"
      },
      "addItems": ["org-feid-or-fl-sales-tax", "hsmv-83039", "expiring-placard-registration-copy"],
      "note": "Organization renewal — submit a new HSMV 83039 with the Application by an Organization section completed, plus a copy of the registration for the expiring permit. Submission options: in person or by mail.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/organizations/"
      ]
    },
    {
      "when": {
        "placard_scenario": "replacement",
        "placard_replacement_reason": "stolen",
        "placard_has_police_report": "yes"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83146", "police-report-stolen-placard"],
      "note": "Replacement for a stolen placard with a police report — fee waived per §320.0848(2)(d). Submit HSMV 83146 in person or by mail with a copy of your vehicle registration.",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
        "https://www.flhsmv.gov/pdf/forms/83146.pdf"
      ]
    },
    {
      "when": {
        "placard_scenario": "replacement",
        "placard_replacement_reason": "stolen",
        "placard_has_police_report": "no"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83146", "payment-1-replacement"],
      "note": "Replacement for a stolen placard without a police report — $1 fee. Submit HSMV 83146 in person or by mail.",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
        "https://www.flhsmv.gov/pdf/forms/83146.pdf"
      ]
    },
    {
      "when": {
        "placard_scenario": "replacement",
        "placard_replacement_reason": "lost-in-transit"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83146"],
      "note": "Replacement for a permit lost in transit within 180 days of issuance — fee waived. Submit HSMV 83146 in person or by mail with a copy of your vehicle registration.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/83146.pdf"]
    },
    {
      "when": {
        "placard_scenario": "replacement",
        "placard_replacement_reason": "lost"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83146", "payment-1-replacement"],
      "note": "Replacement for a lost placard — $1 fee. Submit HSMV 83146 in person or by mail with a copy of your vehicle registration.",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
        "https://www.flhsmv.gov/pdf/forms/83146.pdf"
      ]
    },
    {
      "when": {
        "placard_scenario": "replacement",
        "placard_replacement_reason": "damaged"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83146", "payment-1-replacement"],
      "note": "Replacement for a damaged placard — $1 fee. Bring the damaged placard for surrender. Submit HSMV 83146 in person or by mail.",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
        "https://www.flhsmv.gov/pdf/forms/83146.pdf"
      ]
    },
    {
      "when": {
        "placard_scenario": "replacement",
        "placard_replacement_reason": "defaced"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83146", "payment-1-replacement"],
      "note": "Replacement for a defaced placard — $1 fee. Bring the defaced placard for surrender. Submit HSMV 83146 in person or by mail.",
      "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
    },
    {
      "when": {
        "placard_scenario": "replacement",
        "placard_replacement_reason": "destroyed"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83146", "payment-1-replacement"],
      "note": "Replacement for a destroyed placard — $1 fee. Submit HSMV 83146 in person or by mail.",
      "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
    },
    {
      "when": {
        "placard_scenario": "replacement",
        "placard_replacement_reason": "surrendered"
      },
      "addItems": ["florida-dl-or-id", "hsmv-83146", "payment-1-replacement"],
      "note": "Replacement for a surrendered placard — $1 fee. Submit HSMV 83146 in person or by mail.",
      "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
    },
    {
      "when": {
        "placard_additional_permit_type": "frequent-traveler",
        "placard_duration": "permanent"
      },
      "note": "Frequent-traveler additional permit — Florida allows a second permit for individuals who travel by plane, train, bus, or vessel (one for departure, one for destination). The secondary permit expires the same date as your primary permit, regardless of issuance date. Mark the frequent-traveler box on HSMV 83039. (Not available for temporary permits.)",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/permanent-disabled-person-parking-permits/"
      ]
    },
    {
      "when": {
        "placard_additional_permit_type": "quadriplegic",
        "placard_duration": "permanent"
      },
      "note": "Quadriplegic additional permit — Florida allows a second permit for quadriplegic applicants. The secondary permit expires the same date as your primary permit. Mark the quadriplegic box on HSMV 83039. (Not available for temporary permits; statute caps individuals at two permits total.)",
      "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/320.0848"]
    }
  ],
  "sources": {
    "spreadsheet": "Parking Permits - MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/permanent-disabled-person-parking-permits/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/temporary-disabled-person-parking-permits/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/disabled-person-parking-permits-for-florida-visitors/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/organizations/",
      "https://www.flhsmv.gov/pdf/forms/83039.pdf",
      "https://www.flhsmv.gov/pdf/forms/83146.pdf",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/218/Handicap-Placards",
      "https://www.tcslc.com/319/Parking-Permits"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/320.0848",
      "https://www.flsenate.gov/Laws/Statutes/2024/316.1958"
    ]
  }
}
'::jsonb),
  ('hunting-fishing', '{
  "txnTypeId": "hunting-fishing",
  "baseItems": ["photo-id-all-applicants", "fwc-license-fee"],
  "factsRequired": [
    "fwc_license_category",
    "fwc_applicant_residency",
    "fwc_license_duration",
    "fwc_is_military_eligible",
    "fwc_exemption_claim"
  ],
  "branches": [
    {
      "when": { "fwc_exemption_claim": "senior-65-plus" },
      "addItems": ["fl-driver-license-to-renew"],
      "removeItems": ["fwc-license-fee"],
      "note": "Florida residents age 65+ are EXEMPT from recreational hunting/fishing license fees under §379.353. Bring Florida DL or ID card showing age + residency, or obtain a free Resident 65+ Hunt/Fish Certificate at the tax collector.",
      "sourceRefs": [
        "https://myfwc.com/license/recreational/do-i-need-one/",
        "https://www.flsenate.gov/Laws/Statutes/2024/379.354"
      ]
    },
    {
      "when": { "fwc_exemption_claim": "youth-under-16" },
      "removeItems": ["fwc-license-fee"],
      "note": "Youth under age 16 are exempt from all recreational hunting and fishing licenses (federal duck stamp also exempt) under §379.353.",
      "sourceRefs": [
        "https://myfwc.com/license/recreational/do-i-need-one/",
        "https://www.flsenate.gov/Laws/Statutes/2024/379.354"
      ]
    },
    {
      "when": { "fwc_exemption_claim": "disabled-resident" },
      "addItems": ["disabled-person-hunt-fish-certification"],
      "removeItems": ["fwc-license-fee"],
      "note": "Florida residents certified as totally and permanently disabled qualify for a Florida Resident Disabled Person''s Hunting and Fishing License (free) under §379.353.",
      "sourceRefs": [
        "https://myfwc.com/license/recreational/do-i-need-one/",
        "https://www.flsenate.gov/Laws/Statutes/2024/379.354"
      ]
    },
    {
      "when": { "fwc_exemption_claim": "armed-forces-home-on-leave" },
      "addItems": ["military-orders"],
      "removeItems": ["fwc-license-fee"],
      "note": "Florida residents who are US Armed Forces members, not stationed in Florida and home on leave for 30 days or less, are exempt when orders are presented.",
      "sourceRefs": ["https://myfwc.com/license/recreational/do-i-need-one/"]
    },
    {
      "when": { "fwc_applicant_residency": "non-resident" },
      "note": "Non-resident fees apply; visitor licenses available in 3-day, 7-day, or annual durations for fishing; non-resident hunting license options include 10-day and annual.",
      "sourceRefs": ["https://myfwc.com/license/recreational/visitors/"]
    },
    {
      "when": { "fwc_applicant_residency": "resident", "fwc_is_military_eligible": "yes" },
      "addItems": ["military-gold-sportsman-application"],
      "note": "Florida resident active-duty military qualify for the Military Gold Sportsman''s License at a reduced rate. Present current military ID.",
      "sourceRefs": ["https://myfwc.com/license/recreational/military-gold/"]
    },
    {
      "when": { "fwc_license_category": "hunting" },
      "note": "Hunting license lets the holder take game animals statewide. Additional permits required for deer, turkey, waterfowl, archery, muzzleloading, crossbow seasons, and for certain Wildlife Management Areas.",
      "sourceRefs": ["https://myfwc.com/license/recreational/hunting/"]
    },
    {
      "when": { "fwc_license_category": "saltwater-fishing" },
      "note": "Saltwater fishing license required to attempt to take marine species (including crabs, lobsters, marine plants). Vessel and pier licenses available as alternatives for qualifying groups.",
      "sourceRefs": ["https://myfwc.com/license/recreational/saltwater-fishing/"]
    },
    {
      "when": { "fwc_license_category": "freshwater-fishing" },
      "note": "Freshwater fishing license required for any catch attempt in Florida freshwater (including catch-and-release). Exemptions include the homestead county of residence for a minor child of the homestead owner.",
      "sourceRefs": ["https://myfwc.com/license/recreational/freshwater-fishing/"]
    },
    {
      "when": { "fwc_license_duration": "lifetime" },
      "note": "Lifetime licenses are available only to Florida residents and must be purchased with a Florida DL/ID establishing residency. Separate lifetime options for Freshwater Fishing, Saltwater Fishing, Hunting, Sportsman, and Gold Sportsman.",
      "sourceRefs": ["https://myfwc.com/license/recreational/lifetime-licenses/"]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [],
    "tcslcVerified": ["https://www.tcslc.com/194/Titles-Registrations"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/379.354"]
  }
}
'::jsonb),
  ('id-card', '{
  "txnTypeId": "id-card",
  "baseItems": [
    "primary-id-passport",
    "social-security-card",
    "address-proof-1",
    "address-proof-2"
  ],
  "factsRequired": [
    "id_card_intent",
    "is_us_citizen",
    "has_primary_id",
    "has_social_security_card",
    "address_proof_count",
    "recent_name_change",
    "is_veteran_designation_request",
    "is_100_percent_disabled_veteran"
  ],
  "branches": [
    {
      "when": {
        "id_card_intent": "downgrade-from-dl"
      },
      "addItems": ["fl-driver-license-to-renew"],
      "note": "Downgrade from driver license to ID card. Customer surrenders the driver license; if they failed a vision exam, this is the standard path for 80+ customers who can no longer pass the vision test.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "id_card_intent": "replacement-lost-stolen"
      },
      "addItems": ["mydmv-portal-referral"],
      "note": "Replacement of a lost or stolen ID card is supported online at MyDMV Portal if the customer''s SSN can be verified. In-office replacement also available.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
        "https://mydmvportal.flhsmv.gov/"
      ]
    },
    {
      "when": {
        "has_primary_id": "birth-certificate"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-birth-certificate"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "naturalization-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-naturalization-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "citizenship-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-citizenship-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "consular-report"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-consular-report"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "is_us_citizen": "permanent-resident"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-green-card"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/"]
    },
    {
      "when": {
        "is_us_citizen": "temporary-lawful-presence"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-visa-i94"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/"]
    },
    {
      "when": {
        "recent_name_change": "yes-with-docs"
      },
      "addItems": ["name-change-marriage-cert"],
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "recent_name_change": "yes-missing-docs"
      },
      "note": "BLOCKED: Customer must present certified marriage cert, divorce decree, or court order AND have updated the SSA record before the ID card can be issued with the new name.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "address_proof_count": "zero"
      },
      "removeItems": ["address-proof-1", "address-proof-2"],
      "addItems": ["declaration-of-domicile"],
      "note": "No qualifying Florida-address documents \u2014 customer must obtain a notarized and recorded Declaration of Domicile.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
        "https://stlucieclerk.gov/departments-top-menu/recording-department"
      ]
    },
    {
      "when": {
        "address_proof_count": "one"
      },
      "removeItems": ["address-proof-2"],
      "addItems": ["declaration-of-domicile"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "is_veteran_designation_request": "yes"
      },
      "addItems": ["dd214-or-veteran-id"],
      "sourceRefs": ["https://www.flhsmv.gov/military/"]
    },
    {
      "when": {
        "is_100_percent_disabled_veteran": "yes"
      },
      "addItems": ["va-100-percent-disability-letter"],
      "note": "Per \u00a7322.21(1), 100% T&P disabled veterans qualify for a no-fee Florida ID card.",
      "sourceRefs": [
        "https://www.flhsmv.gov/military/",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.21"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - ID Cards.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/",
      "https://www.flhsmv.gov/military/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/163/Driver-Licenses-Identification-Cards",
      "https://www.tcslc.com/315/Driver-License-IDs"
    ],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/322.21"],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/EO01.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR09.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR15.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR17.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR20.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/AcceptableDocuments.pdf"
    ]
  }
}
'::jsonb),
  ('learner-permit', '{
  "txnTypeId": "learner-permit",
  "baseItems": [
    "primary-id-passport",
    "social-security-card",
    "address-proof-1",
    "address-proof-2",
    "tlsae-course-completion"
  ],
  "factsRequired": [
    "learner_permit_age_bracket",
    "tlsae_completed",
    "knowledge_exam_channel",
    "is_us_citizen",
    "has_primary_id",
    "has_social_security_card",
    "address_proof_count",
    "parent_guardian_present"
  ],
  "branches": [
    {
      "when": {
        "tlsae_completed": "no"
      },
      "note": "BLOCKED: Florida requires the TLSAE (Traffic Law & Substance Abuse Education) course \u2014 also called DETS for minors \u2014 to be completed BEFORE applying for a learner''s license for anyone who has never been issued a driver license in any state or country. Must be completed at an FLHSMV-approved provider; completion reports to FLHSMV automatically.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    },
    {
      "when": {
        "knowledge_exam_channel": "online-third-party",
        "learner_permit_age_bracket": "under-18"
      },
      "addItems": ["parent-proctoring-form"],
      "note": "Online knowledge exam (under 18 only) \u2014 the Parent Proctoring Form (HSMV 71144) must be notarized OR signed in the presence of a driver license examiner.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/71144.pdf",
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    },
    {
      "when": {
        "knowledge_exam_channel": "in-office"
      },
      "addItems": ["cdl-general-knowledge-exam-scheduling"],
      "note": "In-office Class E knowledge exam \u2014 50 multiple-choice questions, 80% required to pass. English only.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    },
    {
      "when": {
        "learner_permit_age_bracket": "under-18",
        "parent_guardian_present": "no"
      },
      "note": "BLOCKED: Applicants under 18 require a parent or legal guardian (over 18) to be present at the office to sign. Siblings or adults without legal guardianship do not qualify.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    },
    {
      "when": {
        "learner_permit_age_bracket": "under-18",
        "parent_guardian_present": "yes"
      },
      "addItems": ["parent-consent-form", "parent-id-valid"],
      "note": "Parental consent for minor applicant \u2014 HSMV 71142 must be signed with the parent/guardian present; parent must bring a valid government-issued photo ID.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/71142.pdf"]
    },
    {
      "when": {
        "has_primary_id": "birth-certificate"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-birth-certificate"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "naturalization-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-naturalization-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "is_us_citizen": "permanent-resident"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-green-card"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/"]
    },
    {
      "when": {
        "is_us_citizen": "temporary-lawful-presence"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-visa-i94"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/"]
    },
    {
      "when": {
        "address_proof_count": "zero"
      },
      "removeItems": ["address-proof-1", "address-proof-2"],
      "addItems": ["declaration-of-domicile"],
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
        "https://stlucieclerk.gov/departments-top-menu/recording-department"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - Learners License.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-exams/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/292/Teen-Corner"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/322.21"],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/EO02.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR04.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR14.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR20.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf"
    ]
  }
}
'::jsonb),
  ('mobile-home-retire', '{
  "txnTypeId": "mobile-home-retire",
  "baseItems": [
    "photo-id-all-applicants",
    "mobile-home-title-retirement-application",
    "clerk-recorded-documents",
    "all-tangible-taxes-paid"
  ],
  "factsRequired": [
    "owns_land_under_mobile_home",
    "title_is_retired_state",
    "clerk_recording_completed",
    "owners_joined"
  ],
  "branches": [
    {
      "when": { "owns_land_under_mobile_home": "no" },
      "note": "BLOCKED: Title retirement is only available when the owner of the mobile home ALSO owns the real property it sits on. Otherwise the mobile home is personal property and keeps its motor-vehicle title.",
      "sourceRefs": ["https://www.tcslc.com/193/Retire-Florida-Title"]
    },
    {
      "when": { "clerk_recording_completed": "no" },
      "note": "BLOCKED: Title retirement is a two-step process. You must first file with the St. Lucie County Clerk of the Circuit Court (Recording Department) BEFORE filing with the Tax Collector''s Office. Clerk fees apply separately; call 772-462-6900 or visit stlucieclerk.gov for details.",
      "sourceRefs": [
        "https://www.tcslc.com/193/Retire-Florida-Title",
        "https://stlucieclerk.gov/departments-top-menu/recording-department"
      ]
    },
    {
      "when": { "owners_joined": "joined-and" },
      "addItems": ["all-applicants-present"],
      "note": "Title joined by ''and'' — each owner must sign the retirement application.",
      "sourceRefs": ["https://www.tcslc.com/193/Retire-Florida-Title"]
    },
    {
      "when": { "title_is_retired_state": "already-retired" },
      "note": "BLOCKED: Title has already been retired. Future transfers use a deed (recorded with the Clerk), not a motor-vehicle title application.",
      "sourceRefs": ["https://www.tcslc.com/193/Retire-Florida-Title"]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"],
    "tcslcVerified": [
      "https://www.tcslc.com/193/Retire-Florida-Title",
      "https://www.tcslc.com/192/Mobile-Homes"
    ],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/319.23"]
  }
}
'::jsonb),
  ('mobile-home-title', '{
  "txnTypeId": "mobile-home-title",
  "baseItems": ["photo-id-all-applicants", "hsmv-82040", "all-applicants-present"],
  "factsRequired": [
    "mobile_home_purchase_source",
    "vehicle_origin",
    "has_lien_or_lease",
    "owns_land_under_mobile_home",
    "transferring_existing_decal"
  ],
  "branches": [
    {
      "when": { "mobile_home_purchase_source": "fl-dealer" },
      "note": "Florida dealer purchase — dealer is required by law to process the Application for Title. Customer does NOT need to file the title paperwork at the tax collector.",
      "sourceRefs": ["https://www.tcslc.com/192/Mobile-Homes"]
    },
    {
      "when": { "mobile_home_purchase_source": "oos-dealer" },
      "addItems": ["mco-or-signed-title", "bill-of-sale-purchase-agreement"],
      "note": "Out-of-state dealer purchase (new mobile home) — customer submits HSMV 82040 with manufacturer''s certificate of origin, bill of sale showing purchase price and sales tax paid, and any applicable lien-holder information.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82040.pdf",
        "https://www.tcslc.com/192/Mobile-Homes"
      ]
    },
    {
      "when": { "vehicle_origin": "us-state" },
      "addItems": ["oos-title-surrender", "bill-of-sale-purchase-agreement"],
      "note": "Previously titled out-of-state — surrender the OOS title. Sales tax paid to another state must be proved; Florida Use Tax may apply if purchased within 6 months. Full 6% Use Tax + local option tax applies to foreign-country imports.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
        "https://www.tcslc.com/192/Mobile-Homes"
      ]
    },
    {
      "when": { "has_lien_or_lease": "lien-active" },
      "addItems": ["lien-letter"],
      "note": "Active lien — lien-holder information required on the title application; title issued to lienholder.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/"]
    },
    {
      "when": { "transferring_existing_decal": "yes" },
      "addItems": ["existing-mobile-home-registration-and-decal"],
      "note": "Transferring an existing mobile-home decal — present the current registration and decal number.",
      "sourceRefs": ["https://www.tcslc.com/192/Mobile-Homes"]
    },
    {
      "when": { "owns_land_under_mobile_home": "yes" },
      "addItems": ["dr-402-real-property-declaration", "rp-decal-note"],
      "note": "Customer owns the land under the mobile home — should apply for a Real Property (RP) decal instead of an annual registration. Requires Declaration of Real Property (DR-402) issued by the Property Appraiser first.",
      "sourceRefs": ["https://www.tcslc.com/192/Mobile-Homes", "https://www.paslc.gov/"]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/192/Mobile-Homes",
      "https://www.tcslc.com/194/Titles-Registrations"
    ],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/319.23"]
  }
}
'::jsonb),
  ('new-vehicle-title', '{
  "txnTypeId": "new-vehicle-title",
  "baseItems": [
    "photo-id-all-applicants",
    "hsmv-82040",
    "mco-or-signed-title",
    "fl-insurance-proof"
  ],
  "factsRequired": [
    "new_vehicle_purchase_source",
    "has_fl_insurance",
    "has_odometer_disclosure",
    "vehicle_model_year_range",
    "has_lien_or_lease",
    "owners_joined",
    "purchaser_age_status",
    "initial_reg_exemption_path",
    "vehicle_class",
    "vehicle_construction_type"
  ],
  "branches": [
    {
      "when": { "has_fl_insurance": "no" },
      "note": "BLOCKED: Florida requires PDL + PIP insurance before a vehicle can be titled AND registered together. Customer can title-only without registering, but that prevents driving the vehicle. For the standard title-plus-registration flow, insurance must be obtained first.",
      "sourceRefs": [
        "https://www.flhsmv.gov/insurance/",
        "https://www.flsenate.gov/Laws/Statutes/2024/627.733"
      ]
    },
    {
      "when": { "new_vehicle_purchase_source": "franchise-dealer" },
      "note": "Franchise dealer purchase — dealer typically handles title paperwork (MCO submission, sales tax remittance). Customer may only need to verify registration and pick up plate. Confirm dealer processed the title before arriving.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": { "new_vehicle_purchase_source": "private-out-of-state" },
      "addItems": ["bill-of-sale-purchase-agreement", "vin-verification-completed"],
      "note": "Private out-of-state purchase — customer provides the OOS title (signed over to them), bill of sale, and completes VIN verification.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
        "https://www.flhsmv.gov/pdf/forms/82042.pdf"
      ]
    },
    {
      "when": { "has_odometer_disclosure": "no", "vehicle_model_year_range": "2011-or-newer" },
      "addItems": ["hsmv-82050"],
      "removeItems": ["mco-or-signed-title"],
      "note": "Vehicles from model year 2011 or newer require a signed odometer disclosure at transfer. If not already on the title, use HSMV 82050 (bill of sale with odometer disclosure). A bill of sale path indicates a used vehicle, so the MCO does not apply — the prior signed title is presented instead.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82050.pdf",
        "https://www.flsenate.gov/Laws/Statutes/2024/319.14"
      ]
    },
    {
      "when": { "has_lien_or_lease": "lien-active" },
      "addItems": ["lien-letter"],
      "removeItems": ["mco-or-signed-title"],
      "note": "Vehicle has an active lien — lienholder information must be present on the title application. Title will be issued electronically to the lienholder. With an active lien, the MCO has already been transferred to the lienholder, so the customer no longer holds it.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/"]
    },
    {
      "when": { "has_lien_or_lease": "lease" },
      "addItems": ["lease-agreement-with-lessor-letter"],
      "removeItems": ["mco-or-signed-title"],
      "note": "Leased vehicle — lease agreement plus lessor letter authorizing title transaction to the customer. The lessor (not the customer) holds title, so the customer does not present the MCO; the lessor letter substitutes for ownership documentation in this branch.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/"]
    },
    {
      "when": { "purchaser_age_status": "minor-no-co-purchaser" },
      "note": "BLOCKED: Minors cannot be sole owners of a Florida title. An adult co-purchaser (18+) must be added to the title and be present to sign.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": { "purchaser_age_status": "minor-with-adult-co-purchaser" },
      "addItems": ["adult-co-purchaser-present"],
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": { "owners_joined": "joined-and" },
      "addItems": ["all-applicants-present"],
      "note": "Title joined by ''and'' — all owners must be present to sign or provide a notarized POA (HSMV 82053).",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/82053.pdf"]
    },
    {
      "when": { "initial_reg_exemption_path": "immediate-family" },
      "addItems": ["hsmv-82002"],
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82002.pdf",
        "https://www.flsenate.gov/Laws/Statutes/2024/320.072"
      ]
    },
    {
      "when": { "vehicle_class": "low-speed-vehicle" },
      "addItems": ["lsv-equipment-cert"],
      "note": "LSVs require equipment compliance certification at title issuance per §316.2122.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": { "vehicle_construction_type": "homemade" },
      "addItems": ["hsmv-84490", "builder-receipts", "hsmv-82105"],
      "removeItems": ["mco-or-signed-title"],
      "note": "Homemade vehicles never had a Manufacturer''s Certificate of Origin. Florida issues a state-assigned VIN after physical inspection. Bring the Statement of Builder (HSMV 84490), parts receipts (sales-tax basis), and a certified weight slip (HSMV 82105) since fees are weight-tiered.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/84490.pdf",
        "https://www.flhsmv.gov/pdf/forms/82105.pdf"
      ]
    },
    {
      "when": { "vehicle_construction_type": "kit-assembled" },
      "addItems": ["hsmv-84490", "builder-receipts", "hsmv-82105"],
      "removeItems": ["mco-or-signed-title"],
      "note": "Kit-assembled vehicles follow the homemade-vehicle path: Statement of Builder, parts receipts, weight affidavit, and a state-assigned VIN issued after physical inspection.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/84490.pdf"]
    }
  ],
  "sources": {
    "spreadsheet": "FL Titles- MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/",
      "https://www.flhsmv.gov/insurance/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/199/New-Vehicle-Title-Application",
      "https://www.tcslc.com/194/Titles-Registrations"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/319.23",
      "https://www.flsenate.gov/Laws/Statutes/2024/319.14",
      "https://www.flsenate.gov/Laws/Statutes/2024/320.072",
      "https://www.flsenate.gov/Laws/Statutes/2024/627.733"
    ]
  }
}
'::jsonb),
  ('plate-surrender', '{
  "txnTypeId": "plate-surrender",
  "baseItems": [
    "photo-id-all-applicants",
    "physical-license-plate-for-surrender",
    "license-plate-surrender-affidavit"
  ],
  "factsRequired": ["plate_surrender_owner_type"],
  "branches": [
    {
      "when": {
        "plate_surrender_owner_type": "personal-not-registrant"
      },
      "addItems": ["lpsa-signed-by-registered-owner", "hsmv-82053"],
      "note": "Third-party surrender for a personal-name plate \u2014 the surrendering individual must bring either (1) the License Plate Surrender Affidavit signed by the registered owner/co-owner, OR (2) a notarized Power of Attorney (HSMV 82053) authorizing the surrender.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82053.pdf",
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/license-plates-registration/"
      ]
    },
    {
      "when": {
        "plate_surrender_owner_type": "business-registered-agent"
      },
      "addItems": ["sunbiz-registration"],
      "note": "Business-owned vehicle plate surrender by a registered agent \u2014 present the Sunbiz printout showing the surrendering individual is an active registered agent of the company.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/license-plates-registration/",
        "https://search.sunbiz.org/"
      ]
    },
    {
      "when": {
        "plate_surrender_owner_type": "business-third-party"
      },
      "addItems": ["hsmv-82053", "sunbiz-registration"],
      "note": "Business-owned vehicle plate surrender by someone other than the registered agent \u2014 requires POA (HSMV 82053) from the registered agent, OR a company letterhead with original signature by a registered agent authorizing the third-party.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/82053.pdf", "https://search.sunbiz.org/"]
    }
  ],
  "sources": {
    "spreadsheet": "Registrations - MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/license-plates-registration/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/304/Lost-or-Stolen-Tags-and-Plate-Surrenders"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/320.02"]
  }
}
'::jsonb),
  ('property-tax', '{
  "txnTypeId": "property-tax",
  "baseItems": ["property-tax-bill-or-parcel-number"],
  "factsRequired": ["property_tax_intent", "is_past_due", "is_property_owner"],
  "branches": [
    {
      "when": {
        "is_past_due": "yes"
      },
      "addItems": ["guaranteed-funds-only"],
      "note": "Past-due (delinquent) taxes must be paid with guaranteed funds ONLY: cashier''s check, cash, debit card, or credit card. Personal checks are NOT accepted for delinquent taxes per local TCSLC policy (backed by \u00a7197.333 \u2014 interest and fees accrue on delinquency).",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/197.252",
        "https://www.tcslc.com/165/Taxes"
      ]
    },
    {
      "when": {
        "property_tax_intent": "installment-plan"
      },
      "addItems": ["dr-534-installment-application"],
      "note": "Installment plan application (DR-534) per \u00a7197.222 \u2014 application must be submitted by April 30 for the upcoming tax year. Four installments due June 30 (6% discount), Sep 30 (4.5%), Dec 31 (3%), Mar 31 (0%). Customer must be the owner to sign.",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/197.222",
        "https://www.tcslc.com/165/Taxes"
      ]
    },
    {
      "when": {
        "property_tax_intent": "partial-payment"
      },
      "addItems": ["partial-payment-affidavit"],
      "note": "Partial payment applies to CURRENT-year taxes only (before delinquency), must be made in up to 3 payments by March 31, no tax discounts apply on partial payments, and minimum $100 per payment.",
      "sourceRefs": [
        "https://www.flsenate.gov/Laws/Statutes/2024/197.222",
        "https://www.tcslc.com/213/Property-Tax-Discounts-Payment-Plans"
      ]
    },
    {
      "when": {
        "property_tax_intent": "change-of-address"
      },
      "addItems": ["paslc-address-change-form", "tcslc-address-change-form"],
      "note": "Property tax mailing-address change is a two-step process: first submit the change on the Property Appraiser''s form (paslc.gov), then submit on the Tax Collector''s form (tcslc.com). Appraiser-side must be completed before the Tax Collector side.",
      "sourceRefs": ["https://www.tcslc.com/165/Taxes", "https://www.paslc.gov/"]
    },
    {
      "when": {
        "property_tax_intent": "exemption-inquiry"
      },
      "note": "Property tax EXEMPTION applications (homestead, senior, disability, veteran) are filed with the Property Appraiser (paslc.gov), not the Tax Collector. Customer directed there.",
      "sourceRefs": ["https://www.paslc.gov/"]
    },
    {
      "when": {
        "property_tax_intent": "payment-standard",
        "is_past_due": "no"
      },
      "addItems": ["personal-check-ok", "fl-discount-schedule"],
      "note": "Standard current-year payment \u2014 personal checks, cash, credit, debit, or cashier''s check accepted. Florida discount schedule applies (\u00a7197.162): 4% November, 3% December, 2% January, 1% February, 0% March.",
      "sourceRefs": ["https://www.tcslc.com/203/Tax-Discounts-Deadlines-By-Month"]
    },
    {
      "when": {
        "is_property_owner": "no"
      },
      "note": "Customer is not the property owner \u2014 installment plan and partial-payment application must be signed by the owner. Standard current-year payment can be made by anyone.",
      "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/197.222"]
    }
  ],
  "sources": {
    "spreadsheet": "Property Tax.xlsx",
    "flhsmvVerified": [],
    "tcslcVerified": [
      "https://www.tcslc.com/165/Taxes",
      "https://www.tcslc.com/202/Important-Dates-Deadlines",
      "https://www.tcslc.com/203/Tax-Discounts-Deadlines-By-Month",
      "https://www.tcslc.com/213/Property-Tax-Discounts-Payment-Plans"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/197.222",
      "https://www.flsenate.gov/Laws/Statutes/2024/197.252"
    ]
  }
}
'::jsonb),
  ('real-id-upgrade', '{
  "txnTypeId": "real-id-upgrade",
  "baseItems": [
    "fl-driver-license-to-renew",
    "primary-id-passport",
    "social-security-card",
    "address-proof-1",
    "address-proof-2"
  ],
  "factsRequired": [
    "is_us_citizen",
    "has_primary_id",
    "has_social_security_card",
    "address_proof_count",
    "recent_name_change"
  ],
  "branches": [
    {
      "when": {
        "has_primary_id": "birth-certificate"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-birth-certificate"],
      "note": "Customer using certified birth certificate as primary identity document.",
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "naturalization-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-naturalization-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "citizenship-cert"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-citizenship-cert"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "has_primary_id": "consular-report"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["primary-id-consular-report"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    },
    {
      "when": {
        "is_us_citizen": "permanent-resident"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-green-card"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/"]
    },
    {
      "when": {
        "is_us_citizen": "temporary-lawful-presence"
      },
      "removeItems": ["primary-id-passport"],
      "addItems": ["lawful-presence-visa-i94"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/"]
    },
    {
      "when": {
        "recent_name_change": "yes-with-docs"
      },
      "addItems": ["name-change-marriage-cert"],
      "note": "Name change accompanying the REAL ID upgrade \u2014 present the certified marriage certificate or court order; SSA record must already reflect the new name.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "recent_name_change": "yes-missing-docs"
      },
      "note": "BLOCKED: Customer must obtain certified name-change documentation (and update SSA record) before the REAL ID upgrade.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
      ]
    },
    {
      "when": {
        "address_proof_count": "zero"
      },
      "removeItems": ["address-proof-1", "address-proof-2"],
      "addItems": ["declaration-of-domicile"],
      "note": "No qualifying Florida-address documents \u2014 customer must obtain a notarized and recorded Declaration of Domicile.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
        "https://stlucieclerk.gov/departments-top-menu/recording-department"
      ]
    },
    {
      "when": {
        "address_proof_count": "one"
      },
      "removeItems": ["address-proof-2"],
      "addItems": ["declaration-of-domicile"],
      "sourceRefs": ["https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/"]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - Class E .xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/real-id/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/u-s-citizen/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/what-to-bring/non-immigrant/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/renew-or-replace-your-florida-driver-license-or-id-card/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/163/Driver-Licenses-Identification-Cards",
      "https://www.tcslc.com/315/Driver-License-IDs"
    ],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/322.21"],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR15.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR09.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR17.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/IR20.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/AcceptableDocuments.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf"
    ]
  }
}
'::jsonb),
  ('registration-renewal', '{
  "txnTypeId": "registration-renewal",
  "baseItems": ["fl-insurance-proof", "current-registration-or-renewal-notice"],
  "factsRequired": ["has_fl_insurance", "is_military_active_duty", "is_heavy_truck_55k_gvw"],
  "branches": [
    {
      "when": { "has_fl_insurance": "no" },
      "note": "BLOCKED: Florida requires continuous motor vehicle insurance on any registered vehicle. Registration cannot be renewed without current proof of Florida Property Damage Liability (PDL) and Personal Injury Protection (PIP) coverage. Customer must obtain Florida insurance before renewing.",
      "sourceRefs": [
        "https://www.flhsmv.gov/insurance/",
        "https://www.flsenate.gov/Laws/Statutes/2024/627.733"
      ]
    },
    {
      "when": { "is_heavy_truck_55k_gvw": "yes" },
      "addItems": ["hvut-2290-proof", "commercial-insurance-limits-proof"],
      "note": "Heavy Vehicle Use Tax applies to trucks with a gross vehicle weight (GVW) of 55,000 lbs or more. Customer must present IRS Form 2290 (or proof of exemption purchased within 60 days) AND commercial-vehicle insurance policy with the correct coverage limits.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/"]
    },
    {
      "when": { "is_military_active_duty": "yes" },
      "addItems": ["military-orders", "military-insurance-affidavit"],
      "note": "Active-duty military stationed outside Florida may use out-of-state insurance with a Military Insurance Affidavit (HSMV 71061) accompanying military orders.",
      "sourceRefs": [
        "https://www.flhsmv.gov/military/",
        "https://www.flhsmv.gov/pdf/forms/71061.pdf"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Registrations - MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/",
      "https://www.flhsmv.gov/insurance/",
      "https://www.flhsmv.gov/military/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/297/Express-Lane-Registration-Renewals",
      "https://www.tcslc.com/318/Vehicle-Registration"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/320.02",
      "https://www.flsenate.gov/Laws/Statutes/2024/627.733"
    ]
  }
}
'::jsonb),
  ('road-test', '{
  "txnTypeId": "road-test",
  "baseItems": [
    "fl-driver-license-to-renew",
    "vehicle-for-road-test",
    "fl-insurance-proof-for-test-vehicle"
  ],
  "factsRequired": [
    "learner_permit_age_bracket",
    "has_learners_license_active",
    "road_test_location",
    "parent_guardian_present"
  ],
  "branches": [
    {
      "when": {
        "has_learners_license_active": "no"
      },
      "note": "BLOCKED: A valid Florida learner''s license must be active to take the Class E Driving Skills Test. Customer must first obtain the learner''s permit.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    },
    {
      "when": {
        "learner_permit_age_bracket": "under-18",
        "parent_guardian_present": "no"
      },
      "note": "BLOCKED: Minor applicants require a parent or legal guardian (over 18) to be present at the road-test appointment.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/"
      ]
    },
    {
      "when": {
        "road_test_location": "walton"
      },
      "addItems": ["walton-road-test-parking-guide"],
      "note": "Walton Road office road-test parking guide \u2014 review before arrival.",
      "sourceRefs": ["https://www.tcslc.com/316/Exams"]
    },
    {
      "when": {
        "road_test_location": "tradition"
      },
      "addItems": ["tradition-road-test-parking-guide"],
      "note": "Tradition office road-test parking guide \u2014 review before arrival.",
      "sourceRefs": ["https://www.tcslc.com/316/Exams"]
    },
    {
      "when": {
        "road_test_location": "ft-pierce"
      },
      "addItems": ["ft-pierce-road-test-parking-guide"],
      "note": "Ft. Pierce office road-test parking guide \u2014 review before arrival.",
      "sourceRefs": ["https://www.tcslc.com/316/Exams"]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-exams/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/behind-wheel-training/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/316/Exams", "https://www.tcslc.com/292/Teen-Corner"],
    "statutes": [],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI10C.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/EO02.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf"
    ]
  }
}
'::jsonb),
  ('specialty-plate', '{
  "txnTypeId": "specialty-plate",
  "baseItems": ["photo-id-all-applicants", "specialty-plate-packet-guide"],
  "factsRequired": ["specialty_plate_flow", "has_specialty_plate_eligibility_proof"],
  "branches": [
    {
      "when": {
        "specialty_plate_flow": "new-plate-on-existing-vehicle"
      },
      "addItems": ["current-registration-or-renewal-notice", "fl-insurance-proof"],
      "note": "Installing a specialty plate on a vehicle already registered in Florida. Bring current registration + proof of insurance. Customer pays specialty-plate annual fee in addition to any prorated registration difference.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/personalized-specialty-license-plates/specialty-license-plates/"
      ]
    },
    {
      "when": {
        "specialty_plate_flow": "voucher-self"
      },
      "note": "Pre-sale specialty license plate voucher purchased for the customer''s own vehicle. Customer can purchase at the office OR online via FLHSMV. Voucher is redeemable when the plate meets the FLHSMV issuance threshold.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/personalized-specialty-license-plates/specialty-license-plates/pre-sale-data/"
      ]
    },
    {
      "when": {
        "specialty_plate_flow": "voucher-gift"
      },
      "addItems": ["recipient-plate-or-license-info"],
      "note": "Purchasing a voucher for someone else \u2014 customer must have the recipient''s name plus either the license plate number OR the driver license number at time of transaction.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/personalized-specialty-license-plates/specialty-license-plates/pre-sale-data/"
      ]
    },
    {
      "when": {
        "has_specialty_plate_eligibility_proof": "no"
      },
      "note": "BLOCKED: Many specialty plates (e.g., university, professional, honor-society) require documented eligibility. Customer must obtain the required proof (alumni letter, membership card, service credential) before applying.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/personalized-specialty-license-plates/specialty-license-plates/"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Registrations - MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/personalized-specialty-license-plates/specialty-license-plates/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/personalized-specialty-license-plates/specialty-license-plates/pre-sale-data/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/307/Specialty-License-Plates-and-Personalized",
      "https://www.tcslc.com/308/Presale-Specialty-License-Plate-Vouchers"
    ],
    "statutes": []
  }
}
'::jsonb),
  ('tag-replacement', '{
  "txnTypeId": "tag-replacement",
  "baseItems": ["photo-id-all-applicants", "hsmv-83146"],
  "factsRequired": ["tag_replacement_reason"],
  "branches": [
    {
      "when": {
        "tag_replacement_reason": "stolen"
      },
      "addItems": ["police-report-or-case-number"],
      "note": "Stolen tag or decal \u2014 customer must bring a police report or police business card with the case number. Without it, replacement cannot proceed.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/proc/rs/rs-43.pdf",
        "https://www.tcslc.com/304/Lost-or-Stolen-Tags-and-Plate-Surrenders"
      ]
    },
    {
      "when": {
        "tag_replacement_reason": "lost-in-transit"
      },
      "note": "Lost-in-transit \u2014 if the renewal was processed online within the past 20 days and the credential never arrived, the replacement is free. After 20 days, standard replacement fees apply.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/license-plates-registration/"
      ]
    },
    {
      "when": {
        "tag_replacement_reason": "defaced"
      },
      "note": "Damaged or defaced decal \u2014 replacement fee applies; no police report required. Bring the old decal if possible.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/license-plates-registration/"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Registrations - MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/license-plates-registration/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/304/Lost-or-Stolen-Tags-and-Plate-Surrenders"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/320.03"]
  }
}
'::jsonb),
  ('tangible-personal-property-tax', '{
  "txnTypeId": "tangible-personal-property-tax",
  "baseItems": ["tpp-bill-or-account"],
  "factsRequired": ["tpp_intent", "tpp_is_past_due"],
  "branches": [
    {
      "when": { "tpp_intent": "file-return" },
      "note": "BLOCKED at this office: TPP returns (DR-405) are filed with the St. Lucie County Property Appraiser, NOT the Tax Collector. Returns must be filed by April 1 each year to claim the $25,000 Amendment 1 exemption. Late filing loses the exemption.",
      "sourceRefs": [
        "https://www.tcslc.com/214/Tangible-Centrally-Assessed-Tax",
        "https://www.paslc.gov/"
      ]
    },
    {
      "when": { "tpp_intent": "inquiry-exemption" },
      "note": "BLOCKED at this office: TPP exemption applications are handled by the St. Lucie County Property Appraiser (paslc.gov), not the Tax Collector. The $25,000 Amendment 1 exemption is claimed by filing the TPP return by April 1 each year.",
      "sourceRefs": [
        "https://www.tcslc.com/214/Tangible-Centrally-Assessed-Tax",
        "https://www.paslc.gov/"
      ]
    },
    {
      "when": { "tpp_intent": "pay-bill", "tpp_is_past_due": "yes" },
      "addItems": ["guaranteed-funds-only"],
      "note": "Delinquent TPP taxes must be paid with guaranteed funds ONLY: cashier''s check, cash, debit, or credit. Personal checks are not accepted on past-due TPP amounts — same rule as real-property delinquent tax.",
      "sourceRefs": [
        "https://www.tcslc.com/214/Tangible-Centrally-Assessed-Tax",
        "https://www.tcslc.com/165/Taxes"
      ]
    },
    {
      "when": { "tpp_intent": "pay-bill", "tpp_is_past_due": "no" },
      "addItems": ["personal-check-ok"],
      "note": "Current-year TPP payment — personal checks accepted, along with cash, credit, debit, or cashier''s check. Bring the TPP bill or account number.",
      "sourceRefs": ["https://www.tcslc.com/214/Tangible-Centrally-Assessed-Tax"]
    }
  ],
  "sources": {
    "tcslcVerified": ["https://www.tcslc.com/214/Tangible-Centrally-Assessed-Tax"]
  }
}
'::jsonb),
  ('tourist-development-tax', '{
  "txnTypeId": "tourist-development-tax",
  "baseItems": ["photo-id-all-applicants", "property-parcel-info"],
  "factsRequired": [
    "tdt_intent",
    "tdt_property_rental_duration",
    "tdt_has_fdor_sales_tax_id",
    "tdt_has_property_manager",
    "tdt_touristexpress_account_status",
    "tdt_channel",
    "is_100_percent_disabled_veteran",
    "is_military_active_duty"
  ],
  "branches": [
    {
      "when": { "tdt_property_rental_duration": "over-6-months" },
      "note": "Tourist Development Tax only applies to rentals of 6 months or less. If you rent exclusively for periods over 6 months, TDT is NOT required. You may still owe state sales tax — check with Florida Department of Revenue.",
      "sourceRefs": ["https://www.tcslc.com/233/Tourist-Development"]
    },
    {
      "when": { "tdt_intent": "new-registration", "tdt_has_fdor_sales_tax_id": "no-needed" },
      "addItems": ["fdor-sales-tax-registration"],
      "note": "BLOCKED: You must first obtain a Florida Department of Revenue (FDOR) sales-tax identification number BEFORE registering for TDT. Contact FDOR at 772-429-2900 or floridarevenue.com.",
      "sourceRefs": ["https://www.tcslc.com/233/Tourist-Development"]
    },
    {
      "when": {
        "tdt_intent": "new-registration",
        "tdt_has_fdor_sales_tax_id": "yes",
        "tdt_touristexpress_account_status": "no-account"
      },
      "addItems": ["touristexpress-application"],
      "note": "New TDT registration — create a TouristExpress account at stlucie.county-taxes.com/tourist, click \"Add account\", answer no in \"Add an account\" but yes in \"Start an application\", and submit. You''ll receive your new tourist tax account number by email once approved.",
      "sourceRefs": [
        "https://www.tcslc.com/233/Tourist-Development",
        "https://www.tcslc.com/DocumentCenter/View/1435"
      ]
    },
    {
      "when": { "tdt_intent": "file-returns" },
      "addItems": ["touristexpress-referral"],
      "removeItems": ["photo-id-all-applicants"],
      "note": "TDT is filed online via TouristExpress. File and pay by the 20th of the month for a 2.5% collection allowance (capped at $30/month). No in-office visit needed for routine filing.",
      "sourceRefs": ["https://www.tcslc.com/233/Tourist-Development"]
    },
    {
      "when": { "tdt_intent": "deactivate" },
      "addItems": ["tourist-inactive-form"],
      "note": "Deactivating a rental property — submit the Tourist Tax Inactive Form. Once the property is no longer rented short-term, the account is marked inactive.",
      "sourceRefs": [
        "https://www.tcslc.com/233/Tourist-Development",
        "https://form.jotform.com/250283874214053"
      ]
    },
    {
      "when": { "tdt_has_property_manager": "yes" },
      "addItems": ["tourist-owner-agent-agreement"],
      "note": "If a property management company files on your behalf, complete the Tourist Owner-Agent Agreement (request from the Tourist Development Tax office via tcslc.com/233/Tourist-Development) so the manager is authorized to file returns for your account.",
      "sourceRefs": ["https://www.tcslc.com/233/Tourist-Development"]
    },
    {
      "when": { "is_military_active_duty": "yes" },
      "note": "Certain members of the military may qualify for TDT exemptions under Florida Statutes. Check with the Tourist Development Tax office for current eligibility rules before filing.",
      "sourceRefs": ["https://www.tcslc.com/233/Tourist-Development"]
    },
    {
      "when": { "tdt_channel": "online-portal" },
      "addItems": ["tdt-online-referral"],
      "removeItems": ["property-parcel-info", "photo-id-all-applicants"],
      "note": "TDT is filed and paid online through the TouristExpress portal. The portal already has the property parcel linked to your account; no in-office documents are required for routine online filing.",
      "sourceRefs": ["https://www.tcslc.com/233/Tourist-Development"]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [],
    "tcslcVerified": [
      "https://www.tcslc.com/233/Tourist-Development",
      "https://www.tcslc.com/DocumentCenter/View/1435",
      "https://form.jotform.com/250283874214053"
    ],
    "statutes": []
  }
}
'::jsonb),
  ('trailer-registration', '{
  "txnTypeId": "trailer-registration",
  "baseItems": ["photo-id-all-applicants", "certified-weight-slip"],
  "factsRequired": [
    "trailer_weight_class",
    "trailer_construction_type",
    "trailer_acquisition_source",
    "trailer_has_parts_receipts"
  ],
  "branches": [
    {
      "when": { "trailer_weight_class": "2000-or-more" },
      "addItems": ["hsmv-82040"],
      "note": "Trailers weighing 2,000 lb or more are required to be titled in Florida per F.S. §319.14. HSMV 82040 is the title application.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82040.pdf",
        "https://www.flsenate.gov/Laws/Statutes/2024/319.14"
      ]
    },
    {
      "when": { "trailer_weight_class": "under-2000" },
      "note": "Trailers under 2,000 lb cannot be titled in Florida (per HSMV TL-10) and are registration-only. No title application needed.",
      "sourceRefs": ["https://www.tcslc.com/302/Trailers"]
    },
    {
      "when": { "trailer_construction_type": "homemade" },
      "addItems": ["parts-receipts-trailer"],
      "note": "Homemade trailers — bring all parts receipts. 6% sales tax is calculated on the total cost of materials.",
      "sourceRefs": ["https://www.tcslc.com/302/Trailers"]
    },
    {
      "when": { "trailer_construction_type": "homemade", "trailer_weight_class": "2000-or-more" },
      "addItems": ["hsmv-84490", "vin-verification-completed"],
      "note": "Homemade trailers ≥2,000 lb need a state-assigned VIN. Compliance Examiner inspects the trailer in-office, assigns the VIN, and completes HSMV 82042. HSMV 84490 (Statement of Builder) is sometimes also required at the examiner''s discretion — bring it filled out to avoid a return trip.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/84490.pdf",
        "https://www.flhsmv.gov/pdf/forms/82042.pdf"
      ]
    },
    {
      "when": { "trailer_construction_type": "homemade", "trailer_has_parts_receipts": "no" },
      "note": "BLOCKED: homemade trailer registration requires receipts so the tax collector can calculate the 6% sales tax on material cost. Without receipts, reconstruct from credit-card statements or contact the office for a market-value estimate before visiting.",
      "sourceRefs": ["https://www.tcslc.com/302/Trailers"]
    },
    {
      "when": {
        "trailer_acquisition_source": "private-purchase",
        "trailer_weight_class": "under-2000"
      },
      "addItems": ["prior-owner-bill-of-sale-trailer"],
      "note": "Private purchase of a sub-2,000 lb trailer — the bill of sale from the prior owner is the proof of ownership (no title exists). Bring the bill of sale showing trailer description, purchase price, and date.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": {
        "trailer_acquisition_source": "private-purchase",
        "trailer_weight_class": "2000-or-more"
      },
      "addItems": ["prior-fl-title-signed-by-seller", "vin-verification-completed"],
      "note": "Private purchase of a ≥2,000 lb trailer — the seller signs over the existing FL title. VIN verification (HSMV 82042) is required because the trailer is changing ownership.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
        "https://www.flhsmv.gov/pdf/forms/82042.pdf"
      ]
    },
    {
      "when": { "trailer_acquisition_source": "dealer-purchase" },
      "addItems": ["dealer-bill-of-sale-trailer"],
      "note": "Dealer purchase — dealer collects FL sales tax at point of sale. Bring the dealer bill of sale showing the tax breakdown. For ≥2,000 lb the dealer also provides MCO or signed-over title.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": {
        "trailer_acquisition_source": "dealer-purchase",
        "trailer_weight_class": "2000-or-more"
      },
      "addItems": ["mco-or-signed-title"],
      "note": "Dealer-purchased ≥2,000 lb trailers come with a Manufacturer Certificate of Origin (new) or signed-over title (used dealer inventory). The dealer hands this to the customer at sale.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": { "trailer_acquisition_source": "inherited" },
      "addItems": ["death-certificate"],
      "note": "Inherited trailer — bring the deceased prior owner''s death certificate plus their existing trailer title (if ≥2,000 lb) signed via probate process. For sub-2,000 lb trailers, the death certificate establishes chain of ownership; no title transfer is needed.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": { "trailer_acquisition_source": "inherited", "trailer_weight_class": "2000-or-more" },
      "addItems": ["prior-fl-title-signed-by-seller"],
      "note": "Inherited ≥2,000 lb trailer — the prior owner''s FL title must be transferred. Probate court documents or a surviving-spouse affidavit may substitute for a signed-over title. Office may require additional paperwork at the examiner''s discretion.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": {
        "trailer_acquisition_source": "out-of-state-transfer",
        "trailer_weight_class": "2000-or-more"
      },
      "addItems": ["oos-title-surrender", "vin-verification-completed"],
      "note": "Out-of-state transfer of a ≥2,000 lb trailer — the OOS title is surrendered to FL and a new FL title is issued. VIN verification (HSMV 82042) is required.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
        "https://www.flhsmv.gov/pdf/forms/82042.pdf"
      ]
    },
    {
      "when": {
        "trailer_acquisition_source": "out-of-state-transfer",
        "trailer_weight_class": "under-2000"
      },
      "addItems": ["oos-registration"],
      "note": "Out-of-state transfer of a sub-2,000 lb trailer — bring the OOS registration as proof of prior ownership. No title is required (FL doesn''t title trailers <2,000 lb).",
      "sourceRefs": ["https://www.tcslc.com/302/Trailers"]
    }
  ],
  "sources": {
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
      "https://www.flhsmv.gov/pdf/forms/82040.pdf",
      "https://www.flhsmv.gov/pdf/forms/82042.pdf",
      "https://www.flhsmv.gov/pdf/forms/84490.pdf",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/302/Trailers"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/319.14"]
  }
}
'::jsonb),
  ('vehicle-registration', '{
  "txnTypeId": "vehicle-registration",
  "baseItems": [
    "photo-id-all-applicants",
    "fl-insurance-proof",
    "original-vehicle-title",
    "hsmv-82040"
  ],
  "factsRequired": [
    "has_fl_insurance",
    "vehicle_origin",
    "vehicle_class",
    "vehicle_construction_type",
    "is_military_active_duty",
    "initial_reg_exemption_path",
    "plate_choice",
    "is_disabled_veteran_plate_request"
  ],
  "branches": [
    {
      "when": { "has_fl_insurance": "no" },
      "note": "BLOCKED: Florida law requires continuous motor vehicle insurance before a vehicle can be registered. Customer must obtain Florida PDL + PIP insurance before visiting.",
      "sourceRefs": [
        "https://www.flhsmv.gov/insurance/",
        "https://www.flsenate.gov/Laws/Statutes/2024/627.733"
      ]
    },
    {
      "when": { "vehicle_origin": "us-state" },
      "addItems": ["oos-title-surrender", "vin-verification-completed"],
      "note": "Out-of-state used vehicles require VIN verification (HSMV 82042) completed before registration — can be done in-office by the clerk or by law enforcement / licensed dealer. Bring the physical OOS title for surrender to FL.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82042.pdf",
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"
      ]
    },
    {
      "when": { "vehicle_origin": "foreign-country" },
      "addItems": ["customs-import-documents", "vin-verification-completed"],
      "note": "Foreign-country vehicles require US Customs import paperwork (EPA / DOT conformity statements, Form 7501 entry summary) in addition to the standard VIN verification.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    },
    {
      "when": { "initial_reg_exemption_path": "immediate-family" },
      "addItems": ["hsmv-82002"],
      "note": "Vehicle acquired from an immediate family member (blood relative, spouse, parent, cousin, stepchild) where seller and purchaser share a residential address qualifies for the §320.072 Initial Registration Fee exemption. Customer completes HSMV 82002.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82002.pdf",
        "https://www.flsenate.gov/Laws/Statutes/2024/320.072"
      ]
    },
    {
      "when": { "initial_reg_exemption_path": "military-surviving-spouse" },
      "addItems": ["hsmv-82002", "death-certificate"],
      "note": "Surviving spouse of a service member acquiring the vehicle via operation of law (inheritance) qualifies for initial registration fee exemption.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/82002.pdf",
        "https://www.flsenate.gov/Laws/Statutes/2024/320.072"
      ]
    },
    {
      "when": { "plate_choice": "transfer-existing-plate" },
      "addItems": ["existing-physical-plate-or-number"],
      "removeItems": [],
      "note": "Transfer an existing plate (registered in the same customer''s name) to the new vehicle. Provide the physical plate OR the plate number; the office will verify plate credit.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/license-plates-registration/"
      ]
    },
    {
      "when": { "plate_choice": "specialty-plate" },
      "addItems": ["specialty-plate-packet-guide"],
      "note": "New specialty license plate. Customer chooses from the Specialty Plate packet — most have eligibility requirements (education/organization membership). Additional annual fee applies on top of the standard registration fee.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/personalized-specialty-license-plates/specialty-license-plates/"
      ]
    },
    {
      "when": { "is_disabled_veteran_plate_request": "yes" },
      "addItems": ["va-summary-of-benefits-letter"],
      "note": "Disabled Veteran license plate — customer must present VA Summary of Benefits letter specifying (1) 100% service-connected, OR (2) being compensated at the 100% rate even if not totally/permanently disabled, OR (3) DVA-financed vehicle purchase. Per §322.21, only ONE plate is fee-reduced per eligible veteran.",
      "sourceRefs": [
        "https://www.flhsmv.gov/military/",
        "https://www.flsenate.gov/Laws/Statutes/2024/322.21"
      ]
    },
    {
      "when": { "is_military_active_duty": "yes" },
      "addItems": ["military-orders", "military-insurance-affidavit"],
      "note": "Active-duty military stationed outside Florida may use out-of-state insurance if accompanied by the Military Insurance Affidavit (HSMV 71061) and military orders.",
      "sourceRefs": [
        "https://www.flhsmv.gov/military/",
        "https://www.flhsmv.gov/pdf/forms/71061.pdf"
      ]
    },
    {
      "when": { "vehicle_class": "low-speed-vehicle" },
      "addItems": ["lsv-equipment-cert"],
      "note": "Low-speed vehicles (LSVs) require equipment compliance certification per §316.2122 (headlamps, brake lamps, mirrors, windshield, seatbelts). Standard insurance applies but only on roads with posted limits ≤35 mph.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/"]
    },
    {
      "when": { "vehicle_class": "motorcycle" },
      "note": "Motorcycle registration uses the same base documents as passenger cars; PIP is NOT required for motorcycles per §627.733, only PDL.",
      "sourceRefs": ["https://www.flsenate.gov/Laws/Statutes/2024/627.733"]
    },
    {
      "when": { "vehicle_construction_type": "homemade" },
      "addItems": ["hsmv-84490", "builder-receipts", "hsmv-82105"],
      "removeItems": ["original-vehicle-title"],
      "note": "Homemade vehicles never had a Manufacturer''s Certificate of Origin or original title. Florida issues a state-assigned VIN after physical inspection. Bring the Statement of Builder (HSMV 84490), parts receipts (sales-tax basis), and a certified weight slip (HSMV 82105) since fees are weight-tiered.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/84490.pdf",
        "https://www.flhsmv.gov/pdf/forms/82105.pdf"
      ]
    },
    {
      "when": { "vehicle_construction_type": "kit-assembled" },
      "addItems": ["hsmv-84490", "builder-receipts", "hsmv-82105"],
      "removeItems": ["original-vehicle-title"],
      "note": "Kit-assembled vehicles follow the homemade-vehicle path: Statement of Builder, parts receipts, weight affidavit, and a state-assigned VIN issued after physical inspection.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/84490.pdf"]
    }
  ],
  "sources": {
    "spreadsheet": "Registrations - MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/license-plates-registration/",
      "https://www.flhsmv.gov/insurance/",
      "https://www.flhsmv.gov/military/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/194/Titles-Registrations",
      "https://www.tcslc.com/318/Vehicle-Registration"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/320.02",
      "https://www.flsenate.gov/Laws/Statutes/2024/320.072",
      "https://www.flsenate.gov/Laws/Statutes/2024/627.733"
    ]
  }
}
'::jsonb),
  ('vehicle-title-transfer', '{
  "txnTypeId": "vehicle-title-transfer",
  "baseItems": [
    "hsmv-82040",
    "original-vehicle-title",
    "photo-id-all-applicants",
    "all-applicants-present",
    "fl-insurance-proof"
  ],
  "factsRequired": [
    "transfer_reason",
    "inheritance_additional_owners",
    "inheritance_has_will",
    "purchaser_age_status",
    "title_possession",
    "title_condition",
    "title_is_oos",
    "title_is_original_paper",
    "vehicle_class",
    "vehicle_origin",
    "has_lien_or_lease",
    "ownership_entity_type",
    "ownership_duration",
    "sales_tax_paid_out_of_state",
    "has_odometer_disclosure",
    "vehicle_model_year_range",
    "has_fl_insurance",
    "vehicle_physically_present",
    "signing_via_poa",
    "is_military_active_duty"
  ],
  "branches": [
    {
      "when": {
        "transfer_reason": "inheritance-deceased-owner",
        "inheritance_additional_owners": "unknown"
      },
      "blocking": {
        "severity": "hard",
        "reason": "heirship-not-established",
        "customerMessage": "Because the owner on the title has passed away, we first need to know who is legally entitled to the vehicle before it can be transferred. That starts with how the title is held — whether the deceased was the only owner, or whether there''s a surviving co-owner (for example a spouse) already on the title.",
        "nextSteps": "Check how the names appear on the title. If a surviving co-owner is listed (joined by \"or\"), the vehicle usually passes to them directly. If the deceased was the sole owner, ownership is determined by the estate — whether there is a will/probate or other heirs. Bring the certified death certificate and the title (or be ready to request a duplicate if you don''t have it), and we''ll confirm the exact estate documents for your situation.",
        "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
      },
      "note": "BLOCKED: inheritance/deceased-owner transfer where heirship is not yet established (additional-owners question unanswered). Heir determination must precede any title logistics. Per SME (tax423/tax424): establish additional owners on the title + whether there is a will BEFORE logistics."
    },
    {
      "when": { "transfer_reason": "inheritance-deceased-owner" },
      "addItems": ["death-certificate-inheritance"],
      "note": "Inheritance/deceased-owner transfer: a certified death certificate of the owner named on the title is required to establish that the prior owner is deceased (SME-confirmed: tax423 deceased-spouse scenario). The full estate-document set beyond the death certificate (will, Letters of Administration, FLHSMV decedent affidavit) depends on the surviving-owner / will / probate path and is confirmed at the counter — see vehicle-title-transfer.review.md for the SME checklist still to be finalized."
    },
    {
      "when": {
        "transfer_reason": "inheritance-deceased-owner",
        "inheritance_additional_owners": "sole-owner-deceased",
        "inheritance_has_will": "no-will-no-probate"
      },
      "blocking": {
        "severity": "hard",
        "reason": "heirship-needs-estate-process",
        "customerMessage": "The deceased was the only owner on the title and there''s no will or probate yet. Florida needs the rightful heir to be legally established before the vehicle can be titled in a new name — we can''t simply transfer it on request.",
        "nextSteps": "Bring the certified death certificate and the title (or request a duplicate if you don''t have it). Because there''s no will or probate, the office will confirm which estate document establishes you as the heir for your specific situation — contact the tax collector''s office to confirm before your visit.",
        "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
      },
      "note": "BLOCKED: sole deceased owner with no will/probate — the lawful heir is not yet established. Per SME, who may take title must be settled first; exact estate document is confirmed at the counter."
    },
    {
      "when": { "transfer_reason": "inheritance-deceased-owner", "has_odometer_disclosure": "no" },
      "removeItems": ["odometer-disclosure-bill-of-sale"],
      "note": "Inheritance: the deceased owner cannot sign a seller''s odometer disclosure, so the standard HSMV 82050 bill-of-sale odometer item does NOT apply and is removed (removeItems are applied after all adds, so this strips the sale-path odometer item that would otherwise aggregate in). SME-confirmed (tax423): ''having a bill of sale or odometer would be unlikely'' for a deceased-owner transfer."
    },
    {
      "when": { "title_possession": "electronic-held" },
      "addItems": ["mydmv-portal-referral"],
      "note": "Title is held electronically by FLHSMV (no paper in hand). There is no physical title to inspect for alterations/signatures, and no paper to bring — the electronic title is converted/printed as part of the transfer. This is NOT a blocker. Per sessions 19d716d3/ae0b2879, the bot must stop asking paper-title-condition questions once the customer says the title is electronic.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/liens-and-titles/paper-liens-and-titles/"
      ]
    },
    {
      "when": { "title_possession": "lost-or-none" },
      "addItems": ["hsmv-82101"],
      "note": "Customer does not have the title and it is not held electronically (lost/destroyed/never received). A duplicate title (HSMV 82101) must be obtained before — or together with — the transfer; the original title cannot be inspected. This is NOT a hard block (the duplicate can be applied for), but the customer must be told they need the duplicate. Per session 19d716d3, the bot looped title-condition questions instead of recognizing the missing title.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/82101.pdf"]
    },
    {
      "when": { "title_condition": "has-alterations" },
      "blocking": {
        "severity": "hard",
        "reason": "title-altered",
        "customerMessage": "Any whiteout, line-through, scratch-out, or alteration on the face of the title voids it, so we can''t process the transfer with this title.",
        "nextSteps": "Obtain a corrected title from the seller (or a duplicate title from the issuing agency) before your appointment. No other document can substitute for a clean title."
      },
      "note": "BLOCKED: Any whiteout, line-through, scratch-out, or alteration on the face of the title voids it. Customer must obtain a corrected title from the seller. No items can satisfy this condition."
    },
    {
      "when": { "title_condition": "missing-seller-signature" },
      "blocking": {
        "severity": "hard",
        "reason": "title-missing-seller-signature",
        "customerMessage": "The seller (and co-seller, if the title lists two owners joined by \"and\") must sign the title before we can transfer it.",
        "nextSteps": "Return to the seller for the missing signature, or have the seller come to the office to sign in person, before your appointment."
      },
      "note": "BLOCKED: Seller (and co-seller, if joined by AND) must sign the title. Customer must return to seller for signature, or the seller can come to the office to sign in person."
    },
    {
      "when": { "title_condition": "missing-purchaser-name" },
      "addItems": ["hsmv-82050"],
      "note": "Purchaser name missing from seller''s-fill-in line — bill of sale (HSMV 82050) required to establish purchaser."
    },
    {
      "when": { "title_is_oos": "yes" },
      "addItems": ["oos-registration"],
      "note": "Out-of-state titles also require the current out-of-state registration."
    },
    {
      "when": { "title_is_oos": "yes", "vehicle_physically_present": "yes-in-lot" },
      "note": "Deputy performs VIN verification on-site — no form needed."
    },
    {
      "when": { "title_is_oos": "yes", "vehicle_physically_present": "no" },
      "addItems": ["hsmv-82042"],
      "note": "VIN verification (HSMV 82042 or Section 7 of 82040) must be completed by law enforcement, FL DMV compliance examiner, FL licensed dealer, FL notary, or US Military Police before the visit."
    },
    {
      "when": { "title_is_original_paper": "paper-photocopy" },
      "blocking": {
        "severity": "hard",
        "reason": "title-photocopy-not-accepted",
        "customerMessage": "Florida does not accept photocopies of titles — we need the original title document to process the transfer.",
        "nextSteps": "Obtain the original title, or request a duplicate title from the issuing state, before your appointment."
      },
      "note": "BLOCKED: Florida does not accept photocopies of titles. Customer must obtain the original or request a duplicate from the issuing state."
    },
    {
      "when": { "title_is_original_paper": "electronic-title-holding-state" },
      "blocking": {
        "severity": "hard",
        "reason": "electronic-title-holding-state",
        "customerMessage": "Your title is held electronically by a lienholder in a title-holding state, so we can''t transfer it on the spot — we first have to write to your lienholder to obtain the paper title.",
        "nextSteps": "Complete the out-of-state Writing Packet with us so we can request the paper title from your lienholder, then schedule a follow-up appointment once it arrives."
      },
      "note": "BLOCKED at intake: customer completes OOS Writing Packet so we can write to their lienholder for the paper title. Provide packet and schedule follow-up."
    },
    {
      "when": { "has_lien_or_lease": "lien-active" },
      "addItems": ["lien-letter"]
    },
    {
      "when": { "has_lien_or_lease": "lease" },
      "addItems": ["lease-agreement-with-lessor-letter"]
    },
    {
      "when": { "purchaser_age_status": "minor-with-adult-co-purchaser" },
      "addItems": ["adult-co-purchaser-present"]
    },
    {
      "when": { "purchaser_age_status": "minor-no-co-purchaser" },
      "blocking": {
        "severity": "hard",
        "reason": "minor-no-co-purchaser",
        "customerMessage": "A minor can''t hold the title alone — Florida requires an adult (18+) co-owner to appear on the title and sign alongside the minor.",
        "nextSteps": "Bring an adult (18+) co-purchaser who will appear on the title and sign at the appointment."
      },
      "note": "BLOCKED: Minor purchasers require an 18+ co-purchaser to appear on title and sign."
    },
    {
      "when": {
        "ownership_duration": "less-than-6-months",
        "vehicle_origin": "us-state",
        "sales_tax_paid_out_of_state": "yes-with-proof"
      },
      "addItems": ["proof-oos-sales-tax"],
      "note": "Out-of-state sales tax credit applied; bring proof to avoid paying FL 6% Use Tax."
    },
    {
      "when": {
        "ownership_duration": "less-than-6-months",
        "vehicle_origin": "us-state",
        "sales_tax_paid_out_of_state": "yes-no-proof"
      },
      "addItems": ["bill-of-sale-purchase-agreement"],
      "note": "Bill of sale needed to establish purchase price for FL Use Tax calculation."
    },
    {
      "when": {
        "ownership_duration": "less-than-6-months",
        "vehicle_origin": "us-state",
        "sales_tax_paid_out_of_state": "no"
      },
      "addItems": ["bill-of-sale-purchase-agreement"],
      "note": "FL 6% Use Tax + local option tax will be collected on the purchase price."
    },
    {
      "when": { "vehicle_origin": "foreign-country" },
      "addItems": ["bill-of-sale-purchase-agreement"],
      "note": "Foreign imports always owe full 6% FL Use Tax + local option tax regardless of ownership duration."
    },
    {
      "when": { "has_odometer_disclosure": "no", "vehicle_model_year_range": "2011-or-newer" },
      "addItems": ["odometer-disclosure-bill-of-sale"],
      "note": "Federal odometer disclosure required; supply via HSMV 82050 bill of sale."
    },
    {
      "when": { "vehicle_model_year_range": "2010-or-older" },
      "note": "Model year exempt from federal odometer disclosure — mileage optional."
    },
    {
      "when": { "signing_via_poa": "yes-owner-absent" },
      "addItems": ["poa-document", "hsmv-82053"],
      "note": "POA form HSMV 82053 with notarization or DocuSign; original must accompany title work to the state."
    },
    {
      "when": { "ownership_entity_type": "business" },
      "addItems": ["sunbiz-registration"]
    },
    {
      "when": { "ownership_entity_type": "trust-single-trustee" },
      "addItems": ["certification-of-trust"]
    },
    {
      "when": { "ownership_entity_type": "trust-multiple-trustees" },
      "addItems": ["certification-of-trust", "all-trustees-present-or-poa"]
    },
    {
      "when": { "has_fl_insurance": "no" },
      "removeItems": ["fl-insurance-proof"],
      "note": "Without FL insurance, we can perform the title transfer only — no registration. Customer must obtain FL insurance before returning for registration."
    },
    {
      "when": { "is_military_active_duty": "yes" },
      "addItems": ["military-orders"],
      "note": "Active-duty military orders can waive initial-registration fee under §320.072 and may substitute for residency documentation."
    },
    {
      "when": { "vehicle_class": "trailer" },
      "addItems": ["hsmv-82105"],
      "note": "Trailers being titled require a certified weight slip (HSMV 82105) since fees and class assignment are weight-based.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/82105.pdf"]
    },
    {
      "when": { "vehicle_class": "low-speed-vehicle" },
      "addItems": ["lsv-equipment-cert"],
      "note": "LSVs require equipment compliance certification at title issuance per §316.2122.",
      "sourceRefs": ["https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"]
    }
  ],
  "sources": {
    "spreadsheet": "FL Titles- MVI.xlsx, Original - OOS Titles - MVI.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/pdf/forms/82040.pdf",
      "https://www.flhsmv.gov/pdf/forms/82042.pdf",
      "https://www.flhsmv.gov/pdf/forms/82050.pdf",
      "https://www.flhsmv.gov/pdf/forms/82053.pdf",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/titles/"
    ],
    "tcslcVerified": [
      "https://www.tcslc.com/194/Titles-Registrations",
      "https://www.tcslc.com/199/New-Vehicle-Title-Application"
    ],
    "statutes": [
      "https://www.flsenate.gov/Laws/Statutes/2024/319.23",
      "https://www.flsenate.gov/Laws/Statutes/2024/320.072"
    ],
    "gpt": ["FL Titles- MVI - GPT Responses.docx"]
  }
}
'::jsonb),
  ('vessel-registration', '{
  "txnTypeId": "vessel-registration",
  "baseItems": [
    "photo-id-all-applicants",
    "hsmv-82040",
    "vessel-title-or-mco-or-bill-of-sale",
    "vessel-hull-id-documented"
  ],
  "factsRequired": ["vessel_origin", "vessel_length_feet", "vessel_intent"],
  "branches": [
    {
      "when": {
        "vessel_intent": "registration-only"
      },
      "removeItems": ["hsmv-82040"],
      "note": "Registration only (no title change) \u2014 no HSMV 82040. Customer provides current registration + proof of ownership if changed.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/vessels/vessel-titling-registrations/"
      ]
    },
    {
      "when": {
        "vessel_length_feet": "less-than-16"
      },
      "note": "Vessels under 16 feet (excluding motorized except as required) may have exemptions from titling; registration still required.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/vessels/vessel-titling-registrations/"
      ]
    },
    {
      "when": {
        "vessel_origin": "us-state"
      },
      "addItems": ["oos-vessel-title-surrender"],
      "note": "Out-of-state vessel \u2014 surrender the OOS title. Verify registration validity in prior state.",
      "sourceRefs": [
        "https://www.flhsmv.gov/motor-vehicles-tags-titles/vessels/vessel-titling-registrations/"
      ]
    },
    {
      "when": {
        "vessel_origin": "antique"
      },
      "addItems": ["hsmv-87243"],
      "note": "Antique vessel (30+ years) \u2014 special antique registration via HSMV 87243.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/87243.pdf"]
    },
    {
      "when": {
        "vessel_origin": "non-titled"
      },
      "removeItems": ["vessel-title-or-mco-or-bill-of-sale"],
      "addItems": ["hsmv-87244"],
      "note": "Non-titled vessel (some small vessels, specific propulsion types) \u2014 HSMV 87244 registration application.",
      "sourceRefs": ["https://www.flhsmv.gov/pdf/forms/87244.pdf"]
    }
  ],
  "sources": {
    "spreadsheet": "",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/vessels/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/vessels/vessel-titling-registrations/",
      "https://www.flhsmv.gov/motor-vehicles-tags-titles/vessels/numbering-and-decals/",
      "https://www.flhsmv.gov/fees/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/164/Vessels"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/328.72"]
  }
}
'::jsonb),
  ('written-test', '{
  "txnTypeId": "written-test",
  "baseItems": ["primary-id-passport", "cdl-general-knowledge-exam-scheduling"],
  "factsRequired": ["learner_permit_age_bracket", "knowledge_exam_channel", "tlsae_completed"],
  "branches": [
    {
      "when": {
        "tlsae_completed": "no"
      },
      "note": "BLOCKED: First-time licensees must complete the TLSAE/DETS course BEFORE attempting the Class E Knowledge Exam. If a previous DL has been held in any state or country, TLSAE is waived.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    },
    {
      "when": {
        "knowledge_exam_channel": "online-third-party",
        "learner_permit_age_bracket": "under-18"
      },
      "addItems": ["parent-proctoring-form"],
      "removeItems": ["cdl-general-knowledge-exam-scheduling"],
      "note": "Online Class E knowledge exam via approved third-party provider; under-18 applicants only. Requires notarized Parent Proctoring Form (HSMV 71144). Exam result is submitted electronically to FLHSMV on pass.",
      "sourceRefs": [
        "https://www.flhsmv.gov/pdf/forms/71144.pdf",
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    },
    {
      "when": {
        "knowledge_exam_channel": "online-third-party",
        "learner_permit_age_bracket": "18-or-older"
      },
      "note": "BLOCKED: Online Class E Knowledge Exam through an approved third-party administrator is only available to applicants under 18. Adults must take the exam in-office or via DELAP (high-school-only).",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    },
    {
      "when": {
        "knowledge_exam_channel": "already-passed"
      },
      "note": "No further testing needed at this visit; FLHSMV record confirms the customer has passed the Class E Knowledge Exam. Per \u00a7322.56(3), a small percentage of exams passed through third parties are randomly selected for a no-fee mandatory re-test.",
      "sourceRefs": [
        "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/"
      ]
    }
  ],
  "sources": {
    "spreadsheet": "Driver License - Learners License.xlsx",
    "flhsmvVerified": [
      "https://www.flhsmv.gov/driver-licenses-id-cards/licensing-requirements-teens-graduated-driver-license-laws-driving-curfews/class-e-knowledge-exam-driving-skills-test/",
      "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-exams/"
    ],
    "tcslcVerified": ["https://www.tcslc.com/316/Exams"],
    "statutes": ["https://www.flsenate.gov/Laws/Statutes/2024/322.21"],
    "opsManualVerified": [
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/CI10B.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/EO02.pdf",
      "https://tcslc.sharepoint.com/sites/KB-StLucie/Documents/Shared/Local/Incoming/Driver%20License%20Manual%20PN/MP08.pdf"
    ]
  }
}
'::jsonb)
) AS tree(txn_type_id_text, steps)
JOIN transaction_types tt ON tt.txn_type_id = tree.txn_type_id_text AND tt.office_id IS NULL
ON CONFLICT (txn_type_id) DO UPDATE SET steps = EXCLUDED.steps;
