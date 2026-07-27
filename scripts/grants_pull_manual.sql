-- Manual grant pull — 2026-07-27. Stands in for netlify/functions/grants-pull.mjs
-- until ANTHROPIC_API_KEY is set. Same shape the function writes: source='auto'
-- and external_key=url, so the insert trigger raises a "New grant" notification
-- and re-running (or the first real scheduled pull) won't duplicate these.
--
-- Only programs with evidence of being OPEN are included. Deliberately excluded:
--   * Sustainable CAP On-Farm Efficiency Program — closed to applications
--   * Canada-Alberta Job Grant — closed to new applications since March 2026
--   * Pollinator Partnership "honey bee colonies" grant — honey-bee specific;
--     TNT runs leafcutter bees, so it does not apply
-- Amounts are left NULL where the funder does not publish a figure.

insert into public.grants
  (title, funder, url, amount_min, amount_max, eligibility_summary, summary,
   closes_on, region, categories, source, external_key)
values
  (
    'Resilient Agricultural Landscape Program (RALP)',
    'Sustainable CAP — Alberta Agriculture and Irrigation',
    'https://www.alberta.ca/sustainable-cap-programs',
    null, null,
    'Alberta producers conserving or enhancing the environmental resilience of their agricultural landscapes. Continuous intake until funding is allocated.',
    'Cost-shared funding to conserve and enhance environmental resilience on farmland.',
    null, 'Alberta', array['sustainability','habitat'], 'auto',
    'https://www.alberta.ca/sustainable-cap-programs'
  ),
  (
    'Accelerating Agricultural Innovations 2.0 (AAI 2.0)',
    'Results Driven Agriculture Research (RDAR)',
    'https://rdar.ca/funding-opportunities/accelerating-agricultural-innovations-2-0',
    null, null,
    'Producer-led applied research advancing innovations or beneficial management practices for Alberta agriculture. Ongoing/continuous intake.',
    'Research funding to develop or prove out new agricultural innovations.',
    null, 'Alberta', array['research','innovation','pollination'], 'auto',
    'https://rdar.ca/funding-opportunities/accelerating-agricultural-innovations-2-0'
  ),
  (
    'Producer Research and Evaluation Project (PREP)',
    'Results Driven Agriculture Research (RDAR)',
    'https://rdar.ca/funding-opportunities',
    null, null,
    'Producer-driven, on-farm research and evaluation projects in Alberta. Ongoing/continuous intake.',
    'Funding for producers to run and evaluate research on their own operation.',
    null, 'Alberta', array['research','on-farm'], 'auto',
    'https://rdar.ca/funding-opportunities'
  ),
  (
    'Irrigation Targeted Call',
    'Results Driven Agriculture Research (RDAR)',
    'https://albertabusinessgrants.ca/grants/irrigation-targeted-call-results-driven-agriculture-research-rdar/',
    null, 500000,
    'Irrigation research on drought management and production resilience; up to 80% of admissible expenses, capital eligible. Letters of Intent accepted continuously, no fixed deadline.',
    'Research funding for irrigation, drought management and production resilience.',
    null, 'Alberta', array['research','irrigation'], 'auto',
    'https://albertabusinessgrants.ca/grants/irrigation-targeted-call-results-driven-agriculture-research-rdar/'
  ),
  (
    'Alberta Manufacturing Productivity Grant (AMPG)',
    'Canadian Manufacturers & Exporters (for Government of Alberta)',
    'https://www.alberta.ca/alberta-manufacturing-productivity-grant',
    null, 30000,
    'CHECK ELIGIBILITY: restricted to Alberta MANUFACTURERS with 5–750 employees, in business 2+ years. Matching funding for technology adoption and equipment; first-come, first-served.',
    'Up to $30,000 matching funding for technology and equipment upgrades.',
    '2026-10-31', 'Alberta', array['small business','equipment','technology'], 'auto',
    'https://www.alberta.ca/alberta-manufacturing-productivity-grant'
  ),
  (
    '2026 ABC Bursary',
    'Alberta Beekeepers Commission',
    'https://www.albertabeekeepers.ca/community-resources/2026-abc-bursary/',
    null, 1000,
    'Individuals in the Alberta beekeeping industry; three bursaries of $1,000 each. Small — best suited to staff education/training.',
    'Bursary for people working in Alberta''s beekeeping industry.',
    null, 'Alberta', array['bees','training'], 'auto',
    'https://www.albertabeekeepers.ca/community-resources/2026-abc-bursary/'
  )
on conflict (external_key) do nothing;
