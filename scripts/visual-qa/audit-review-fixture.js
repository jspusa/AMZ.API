/* Synthetic recheck evidence only. Never loaded by the shipped application. */
(() => {
  const original = window.fbaOS.api.request;
  window.__auditReviewRound = 0;
  window.fbaOS.api.request = async request => {
    const result = await original(request);
    const body = request.body?.kind === 'json' ? request.body.value : null;
    if (request.path !== '/api/sp-api/standalone-audit' || body?.kind !== 'content' || !result.body?.value?.snapshot || !window.__auditReviewRound) return result;
    const response = structuredClone(result), data = response.body.value.snapshot;
    response.body.value.jobId = `34000000-0000-4400-8400-${String(window.__auditReviewRound + 10).padStart(12,'0')}`;
    response.body.value.contextId = `34000000-0000-4400-8401-${String(window.__auditReviewRound + 10).padStart(12,'0')}`;
    data.fetchedAt = new Date(Date.parse(data.fetchedAt) + window.__auditReviewRound * 3600000).toISOString();
    data.exportId = 'review-recheck-' + window.__auditReviewRound;
    const first = data.rows.find(row => row.sellerSku === 'CSS04-MISSING-BULLETS');
    first.title = first.title.replace('Trukey', 'Turkey');
    first.issues = first.issues.filter(issue => issue.kind !== 'SUSPECTED_TYPO');
    first.issues.push({ kind: 'TITLE_BELOW_TARGET', field: 'title', source: 'amazon-content', message: 'Synthetic local title-length target, not Amazon policy' });
    const second = data.rows.find(row => row.sellerSku === 'CSS04-TYPO-ONLY');
    second.readStatus = 'incomplete'; second.issues = [];
    second.readErrors = [{code:'LISTING_CONTENT_NOT_RETURNED',message:'Synthetic incomplete recheck; cannot establish resolution'}];
    return response;
  };
})();
