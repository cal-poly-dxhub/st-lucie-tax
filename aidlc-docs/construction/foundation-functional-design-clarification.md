# Foundation Functional Design — Clarification Questions

Your answer to Question 10 needs a bit more detail to get the data lifecycle right.

---

## Clarification 1: PII Scope for 30-Day Deletion
You said "delete drivers license at 30 days, 3 years for general correspondence." I want to make sure the boundary is clear.

Which PII data gets deleted at 30 days?

A) DL photos and uploaded documents only (S3 objects + DynamoDB document metadata records). Customer name, phone, email stay on the appointment/session record for 3 years.
B) DL photos, uploaded documents, AND customer identity fields (name, DOB, DL number, address) — strip these from the customer/session record at 30 days, keep the appointment skeleton (transaction types, durations, timestamps) for 3 years.
C) DL photos, uploaded documents, AND the entire customer record. Only appointment and chat transcript records survive for 3 years.
D) Other (please describe after [Answer]: tag below)

[Answer]: A

---
