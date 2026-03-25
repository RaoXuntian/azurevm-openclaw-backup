# Commit Message Examples

## Good Examples

```
feat(auth): add OAuth2 login flow
fix(api): handle null response from payment gateway
refactor(db): extract query builder into separate module
docs(readme): add deployment instructions
test(auth): add integration tests for login
chore(deps): upgrade express to 4.19
backup: snapshot coding agent and ui-ux-pro-max skill
chore(release): bump version to 2.1.0
```

## Bad Examples

```
Updated stuff                    # no type, vague
feat: Add New Feature.           # capitalized, period, generic
fixed bug                        # no type prefix, past tense
feat(auth): add OAuth2 login flow for the new authentication system that supports multiple providers including Google and GitHub  # >72 chars
```

## Body Examples

```
fix(parser): handle edge case in CSV import

The parser crashed when encountering empty rows at the end of file.
Root cause was an off-by-one error in the row counter.

Closes #142
```

## Branch Naming Examples

```
feature/add-oauth-login
fix/csv-parser-empty-rows
docs/api-reference
refactor/extract-query-builder
chore/upgrade-dependencies
backup/pre-migration-snapshot
```
