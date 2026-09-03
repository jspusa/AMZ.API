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

**Control Console Release**:
A GitHub Pages publication that changes the operator interface without changing the Notebook Key's local Amazon or security capabilities.
_Avoid_: App update, desktop release

**Notebook Key Release**:
One versioned, publisher-signed desktop capability release built from the same source for macOS and Windows.
_Avoid_: UI deployment, patch pack

**Bootstrap Notebook Key**:
The one manually installed publisher-signed Notebook Key that establishes the stable signing identity required for later background updates.
_Avoid_: Every update, web reinstall

**Operations Bulletin Board**:
The shared collection of manually maintained expiry notices and Amazon promotion dates read from the fixed Supply Boss API; AMZ.API provides the operator-friendly form and a main-owned authenticated editor, while Supply Boss owns the shared R2 object.
_Avoid_: Amazon expiry report, GitHub Issue board, user-configured R2 editor, public anonymous editor

Related decision: [ADR 0003](docs/adr/0003-use-supply-boss-for-operations-board.md).

**Board Announcement**:
One validated expiry notice or promotion item in the Operations Bulletin Board; authenticated create, edit, or delete republishes the revisioned shared board.
_Avoid_: GitHub Issue, Amazon event, inventory record

**Board Session**:
A board-scoped Supply Boss login token issued only from the separate board-editor credentials and held in Notebook Key main-process memory for at most eight hours; it cannot authorize the legacy Supply Boss admin API. Lock, sleep, App exit, or expiry clears it, while closing the editor does not.
_Avoid_: GitHub login, saved password, renderer token, permanent session

**B2B Audit Bucket**:
One of four mutually exclusive row classifications—Needs Action, Missing, Correctly Configured, or Incomplete—whose counts sum to All; row-level mismatch reasons may overlap without becoming extra summary buckets.
_Avoid_: overlapping summary count, issue counter, configured count

**Approved Family Worksheet**:
A content-audit family worksheet whose every row is complete and passes every check, displayed with the `(可)` suffix such as `F001(可)`; the suffix is a human cue, not write authorization.
_Avoid_: partially passing worksheet, editable worksheet, approved Amazon mutation

**Manual Expiry Date**:
An operator-entered SKU date used for the bulletin countdown and calendar marker; it is not Amazon FC lot-expiry evidence and remains separate from live inventory and price reads.
_Avoid_: Amazon expiry date, aged-inventory evidence
