# Executive profile research task

Research the current top operating executive for every company in the supplied batch. Produce one
standalone JSON document per task; do not combine profiles into a wrapper or array. Each document
must satisfy the `executiveProfileSchema` in `src/lib/research/schemas.ts`; do not add fields or
prose.

## Leadership selection

1. Select the current CEO. When the company officially has co-CEOs, include every co-CEO in one
   leadership slate and use `co_ceo` for each.
2. Use `president`, `executive_chair`, or `managing_director` only when the company has no CEO and
   an official company page or SEC filing explicitly identifies that person as its principal/top
   operating executive.
3. Do not select a divisional, regional, or ceremonial leader. Do not infer leadership from
   seniority, prominence, or a title alone.
4. Set `leadership_as_of` to the date on which the leadership was verified.

## Sources and factual safety

- Every `role_source` must be an official company leadership/investor-relations page or SEC filing
  that explicitly identifies the person as a top executive.
- Use reputable biographies, educational institutions, and reputable reporting for life history.
- Cite every summary with `summary_sources`, every fact with `sources`, the role with `role_source`,
  and the portrait with its source page.
- Use the direct HTTPS image URL in `portrait.image_url`; it must depict the real person. Never use
  a logo, illustration, avatar, placeholder, or generated portrait.
- Never infer birthplace, upbringing, nationality, heritage, ethnicity, religion, education,
  family details, or any other personal fact from a name, appearance, accent, or indirect clue.
  Include a personal fact only when a cited source explicitly states it.
- Paraphrase sources. Do not fabricate missing details or fill gaps with plausible claims.
- Make each leader summary 80–200 words and keep each fact concise.
- Use the retrieval date, not a source publication date, for `retrieved_at`.

If no current top executive can be verified without inference, do not fabricate a profile. Return
this task-identity-preserving artifact instead; list the exact blockers and any reputable candidate
sources. It intentionally fails the freeze gate and is reported separately by manifest validation.

```json
{
	"schema_version": 1,
	"status": "needs_review",
	"issuer_key": "copied exactly from the task",
	"canonical_ticker": "copied exactly from the task",
	"company_name": "copied exactly from the task",
	"reasons": ["Specific unresolved leadership or evidence problem."],
	"candidate_sources": []
}
```

## JSON shape

```json
{
	"schema_version": 1,
	"issuer_key": "copied exactly from the task",
	"canonical_ticker": "copied exactly from the task",
	"company_name": "copied exactly from the task",
	"leadership_as_of": "YYYY-MM-DD",
	"leaders": [
		{
			"name": "Full name",
			"title": "Official title",
			"role_kind": "ceo",
			"is_interim": false,
			"summary": "80–200 words",
			"summary_sources": [
				{
					"url": "https://...",
					"title": "Page title",
					"publisher": "Publisher",
					"retrieved_at": "YYYY-MM-DD",
					"kind": "official_company"
				}
			],
			"role_source": {
				"url": "https://...",
				"title": "Page title",
				"publisher": "Publisher",
				"retrieved_at": "YYYY-MM-DD",
				"kind": "official_company"
			},
			"portrait": {
				"image_url": "https://.../portrait.jpg",
				"alt_text": "Portrait of Full name",
				"is_real_person": true,
				"source": {
					"url": "https://...",
					"title": "Page containing the portrait",
					"publisher": "Publisher",
					"retrieved_at": "YYYY-MM-DD",
					"kind": "official_company"
				}
			},
			"facts": [
				{
					"category": "education",
					"value": "Fact explicitly supported by the cited source.",
					"sources": [
						{
							"url": "https://...",
							"title": "Page title",
							"publisher": "Publisher",
							"retrieved_at": "YYYY-MM-DD",
							"kind": "reputable_biography"
						}
					]
				}
			]
		}
	]
}
```

Allowed `role_kind` values are `ceo`, `co_ceo`, `president`, `executive_chair`, and
`managing_director`. Allowed fact categories are `birthplace`, `upbringing`, `origin`, `education`,
`career`, `achievement`, `personal`, and `other_notable`. Allowed source kinds are
`official_company`, `sec_filing`, `educational_institution`, `reputable_biography`,
`reputable_news`, and `other_reputable`.
