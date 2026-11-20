# Movement guide revision pipeline (#305)

A Needs revision decision currently saves the admin's feedback and files a linked GitHub issue. The following stages will connect that issue to a pose author, staging, and production.

1. **Authoring intake.** Route the app-created issue to a configured pose author. Carry the issue number, guide slug, reviewed revision, pose, and review note as data. A request for renderer, rig, or application changes goes through the regular PR process.
2. **Staging guard.** Run the scope check from trusted workflow code against the exact base and tested candidate commits. Require the normal Checks job, including the guide suite and browser walkthrough, for that candidate. Merge only the checked head SHA. The per-exercise render fingerprint may change alongside its JSON and SVGs. Index, renderer, workflow, and other-guide changes require regular review.
3. **Approval.** After fit-test deploys, the exact revision returns to Pending. Use a persisted Good decision for that revision as the release input. A previous decision on another revision does not authorize a release.
4. **Production and closeout.** Apply the approved guide on top of production, checking it against the production renderer before deploying. Keep the approved content in Git so a routine production deployment will preserve it. After verifying that production serves the approved revision, close the linked revision issue and update #1.

The scope guard is available for the staging integration:

```sh
node .github/scripts/guide-revision-scope.mjs <base-sha> <candidate-sha> <exercise-slug>
```

The future workflow must supply the exercise slug from the trusted revision request and use immutable commit SHAs. This command checks file scope. The regular guide suite verifies the render fingerprints and pose validity. The guard does not grant deployment permissions or treat GitHub issue text as a command.
