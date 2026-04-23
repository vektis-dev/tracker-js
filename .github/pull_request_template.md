## Summary

<!-- What does this PR do? Keep it brief. -->

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would change existing behavior)
- [ ] Documentation (changes to docs only)
- [ ] Refactor (code change that neither fixes a bug nor adds a feature)
- [ ] Test (adding or updating tests)
- [ ] Build/CI (changes to build tooling, CI workflows, or release pipeline)

## Related Issues

<!-- Link any related issues. Use "Closes #123" or "VEK-XXX" to reference Linear tickets. -->

## Checklist

- [ ] I have performed a self-review of my code
- [ ] `npm run typecheck` passes (once scaffolded)
- [ ] `npm test` passes (once scaffolded)
- [ ] `npm run build` produces ESM + IIFE + `.d.ts` bundles (once scaffolded)
- [ ] Bundle size stays under 5KB gzipped target (under 8KB hard cap)
- [ ] Zero runtime dependencies preserved
- [ ] Contract test passes against `@vektis-io/events-schema` (if touching event payload generation)

## Notes for Reviewers

<!-- Anything specific reviewers should look at or test? -->
