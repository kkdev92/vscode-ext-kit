# foundation/

The platform-independent construction and runtime core. Start with the pipeline,
because ownership follows it:

1. `modules/definition.ts` records an inert, immutable `ModuleDefinition`.
2. `application/plan.ts` validates Modules and compiles an `ApplicationPlan`.
3. `application/application.ts` binds that plan transactionally at activation.
4. `hosting/application-host.ts` owns the single start, rollback and stop path.

`resources/` separates synchronous ingress registrations from asynchronously
drained Resources. `services/` validates and resolves declared dependencies.
`operations/` gives each command or task identity, cancellation, logging,
progress and a ResourceScope. `platform/ports.ts` contains the structural
capability contracts implemented by both VS Code adapters and testing fakes.

Nothing in this directory imports `vscode`. Keep platform object construction
and conversion in `src/vscode`; use a raw registration only when no managed
capability exists, and still place every returned registration or Resource in
the supplied scope.

When extending foundation, preserve these invariants:

- Module definition is synchronous and side-effect free.
- Definition-time preflight runs before platform binding.
- Activation commits per-Module ownership only after binding succeeds.
- Host stop closes RegistrationScopes before awaiting ResourceScopes.
- Service factories are synchronous; asynchronous startup belongs in hosted
  services.
- Every asynchronous ingress path runs as an Operation.
