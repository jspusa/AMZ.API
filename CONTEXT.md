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
