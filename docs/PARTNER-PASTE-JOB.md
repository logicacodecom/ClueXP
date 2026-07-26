# Partner Paste Job Intake

The Paste Job workflow lets partner dispatchers paste unstructured job text, parse it deterministically, review the extracted fields in the standard intake form, and then create the request.

Parsing is a read-only step: `POST /provider/jobs/parse-text` returns extracted fields and never writes. Creation goes through the existing `POST /provider/requests`, so a pasted job lands in the dispatch queue on exactly the same path — and under exactly the same required-field rules — as a phone intake. There is no draft state: a job the dispatcher cannot complete is not created.

## Persistence Mapping

No new database fields or migrations. When the dispatcher confirms creation, parsed values are mapped into existing job creation fields:

- Customer name -> `customer_name`
- Customer phone -> `customer_phone`
- Service location -> `address`
- Service category/type -> `access_type` and `situation`
- Description -> existing dispatcher notes text

Useful values without an existing structured job field are appended to the notes payload under `Imported partner details:` — external job IDs, secondary references, external confirmation URLs, detected source, and vehicle details when not already represented by the vehicle form fields.

Notes are ordered so truncation degrades gracefully: dispatcher-entered notes first, then imported partner metadata, then the intake fields (authority, safety, scheduling, address verification), and the verbatim pasted text last. `ManualIntakeRequest.notes` is capped at 2,000 characters server-side; the UI composes within that cap and warns before creating when the pasted text had to be trimmed, so the discarded content is always the tail of the raw paste rather than an operational field.

## Parser Notes

- Input is capped at 8,000 characters (`MAX_INPUT_LENGTH`); longer bodies get a 413.
- Every regex quantifier that can consume whitespace is explicitly bounded. Unbounded lazy quantifiers backtracked catastrophically on long comma-free input (32s for one 8KB paste, blocking the whole worker since parsing is synchronous inside the async endpoint). `test_max_length_input_cannot_stall_the_event_loop` guards this.
- Non-`http(s)` confirmation URLs are dropped with an `unsafe_url_rejected` warning.
- Unrecognized service text warns rather than guessing; the dispatcher picks the service in the review form.
