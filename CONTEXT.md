# AMZ.API

AMZ.API is a private, FBA-only Amazon Seller operations console for Jasper's marketplace workflows.

## Language

**Marketplace Day**:
A calendar day defined by an Amazon marketplace's local time zone.
_Avoid_: UTC day, rolling 24 hours

**FBA Sales Trend**:
A marketplace-wide daily series of FBA sales that may include the current, incomplete Marketplace Day.
_Avoid_: Orders trend, account sales trend

**FBA Sales Velocity**:
The exact Seller SKU's average daily units over the 30 completed Marketplace Days immediately preceding the current Marketplace Day.
_Avoid_: recent 30-day sales, Orders-scan velocity

**Write Gate**:
The main-owned safety kernel that joins short-lived preview evidence and native authorization for an exact Amazon mutation with durable evidence of its outcome.
_Avoid_: Router write helper, approval dialog

**Write Binding**:
The exact execution context, account, operation, proposal, and idempotency identity that must remain unchanged from preview through commit.
_Avoid_: Request body, preview payload

**Preview Ticket**:
Short-lived main-only evidence that one Write Binding passed preview; it is neither native approval nor proof that Amazon accepted a mutation.
_Avoid_: Commit token, write receipt

**Unknown Write Result**:
A durable outcome meaning Amazon may have received a mutation but canonical evidence cannot yet prove success or rejection, so resend remains forbidden.
_Avoid_: Failed write, retryable error
