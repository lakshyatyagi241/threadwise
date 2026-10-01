#!/usr/bin/env python3
"""Tests for the Stop-hook gate, scope detection and stamps. Builds a throwaway git repo; touches nothing else.

  python3 .claude/skills/threadwise-playwright-parity/scripts/test_scripts.py
"""
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo (also covers the sibling skill modules we import)
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.realpath(__file__))
PY = sys.executable
CONTROLLER = """import { Controller, Get, Post, Patch } from '@nestjs/common';

@Controller({ path: 'widgets', version: '2' })
export class WidgetsController {
  @Get() list() {}
  @Get(':id') one() {}
  @Post() create() {}
  @Patch(':id') update() {}
}
"""


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env={**os.environ, **(env or {})})


class Repo(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = os.path.join(self.tmp.name, "repo")
        os.makedirs(self.dir)
        sh(self.dir, "git", "init", "-q", "-b", "main")
        sh(self.dir, "git", "config", "user.email", "t@example.com")
        sh(self.dir, "git", "config", "user.name", "t")
        self.write("README.md", "base\n")
        sh(self.dir, "git", "add", "-A")
        sh(self.dir, "git", "commit", "-q", "-m", "base")
        self.env = {"PARITY_REPO_ROOT": self.dir, "PARITY_GATE": ""}

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text):
        p = os.path.join(self.dir, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(text)

    def gate(self, payload=None, env=None, raw=None):
        t0 = time.time()
        r = subprocess.run([PY, os.path.join(HERE, "stop_gate.py")], input=raw if raw is not None else json.dumps(payload or {"hook_event_name": "Stop"}),
                           capture_output=True, text=True, env={**os.environ, **self.env, **(env or {})}, cwd=self.dir)
        self.last_ms = (time.time() - t0) * 1000
        return r

    def script(self, name, *args, env=None):
        return subprocess.run([PY, os.path.join(HERE, name), *args], capture_output=True, text=True, env={**os.environ, **self.env, **(env or {})}, cwd=self.dir)


class GateTests(Repo):
    def test_clean_tree_allows(self):
        r = self.gate()
        self.assertEqual((r.returncode, r.stdout.strip()), (0, ""))

    def test_feature_change_blocks_with_actionable_reason(self):
        self.write("apps/api/src/modules/widgets/widgets.controller.ts", CONTROLLER)
        r = self.gate()
        self.assertEqual(r.returncode, 0)
        d = json.loads(r.stdout)
        self.assertEqual(d["decision"], "block")
        self.assertIn("threadwise-playwright-parity", d["reason"])
        self.assertIn("fingerprint", d["reason"])
        self.assertLess(self.last_ms, 1500, "the gate must stay cheap")

    def test_stop_hook_active_never_blocks(self):
        self.write("apps/api/src/modules/widgets/widgets.controller.ts", CONTROLLER)
        self.assertEqual(self.gate({"hook_event_name": "Stop", "stop_hook_active": True}).stdout.strip(), "")

    def test_stamp_silences_exactly_that_state(self):
        self.write("apps/api/src/modules/widgets/widgets.controller.ts", CONTROLLER)
        self.assertIn("block", self.gate().stdout)
        w = self.script("stamp.py", "write", "--status", "clean", "--features", "TW-WID-001")
        self.assertEqual(w.returncode, 0, w.stderr)
        self.assertEqual(self.gate().stdout.strip(), "")
        # the state changes -> the old stamp no longer applies
        self.write("apps/api/src/modules/widgets/widgets.controller.ts", CONTROLLER + "// changed\n")
        self.assertIn("block", self.gate().stdout)

    def test_blocks_at_most_twice_per_state(self):
        self.write("apps/web/src/features/widgets/Widget.tsx", "export const W = () => null;\n")
        self.assertIn("block", self.gate().stdout)
        self.assertIn("block", self.gate().stdout)
        self.assertEqual(self.gate().stdout.strip(), "")

    def test_opt_out_env_and_marker(self):
        self.write("apps/api/src/modules/widgets/widgets.controller.ts", CONTROLLER)
        self.assertEqual(self.gate(env={"PARITY_GATE": "off"}).stdout.strip(), "")
        self.script("stamp.py", "disable")
        self.assertEqual(self.gate().stdout.strip(), "")
        self.script("stamp.py", "enable")
        self.assertIn("block", self.gate().stdout)

    def test_non_feature_changes_do_not_trigger(self):
        self.write("apps/api/src/modules/widgets/widgets.service.spec.ts", "it('x', () => {});\n")
        self.write("docs/api/widgets.md", "# docs\n")
        self.write(".claude/skills/x/SKILL.md", "x\n")
        self.write("apps/web/e2e/widgets/a.spec.ts", "x\n")
        self.write("apps/api/src/common/util.ts", "export {};\n")
        self.assertEqual(self.gate().stdout.strip(), "")

    def test_garbage_input_and_non_repo_fail_open(self):
        self.assertEqual(self.gate(raw="not json").returncode, 0)
        self.assertEqual(self.gate(raw="").stdout.strip(), "")
        with tempfile.TemporaryDirectory() as empty:
            r = subprocess.run([PY, os.path.join(HERE, "stop_gate.py")], input="{}", capture_output=True, text=True, env={**os.environ, "PARITY_REPO_ROOT": empty})
            self.assertEqual((r.returncode, r.stdout.strip()), (0, ""))

    def test_committed_branch_work_counts(self):
        sh(self.dir, "git", "checkout", "-q", "-b", "lakshya/widgets/TW-WID-001-create")
        self.write("apps/api/src/modules/widgets/widgets.controller.ts", CONTROLLER)
        sh(self.dir, "git", "add", "-A")
        sh(self.dir, "git", "commit", "-q", "-m", "feat(widgets): TW-WID-001 create")
        self.assertIn("block", self.gate().stdout)  # committed on the branch, still unverified


class ScopeTests(Repo):
    def test_routes_features_domains(self):
        sh(self.dir, "git", "checkout", "-q", "-b", "lakshya/widgets/TW-WID-001-create")
        self.write("apps/api/src/modules/widgets/widgets.controller.ts", CONTROLLER)
        self.write("apps/web/src/app/(app)/(widgets)/widgets/[id]/page.tsx", "export default function P() { return null; }\n")
        self.write("apps/web/src/features/widgets/index.ts", "export {};\n")
        r = self.script("detect_scope.py")
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        self.assertIn("widgets", d["domains"])
        self.assertEqual([f["id"] for f in d["features"]], ["TW-WID-001"])
        got = {(x["method"], x["path"]) for x in d["routes"]["api"]}
        self.assertEqual(got, {("GET", "/v2/widgets"), ("GET", "/v2/widgets/:id"), ("POST", "/v2/widgets"), ("PATCH", "/v2/widgets/:id")})
        self.assertEqual(d["routes"]["web"], ["/widgets/[id]"])
        self.assertTrue(d["surface"] and d["has_ui"] and d["has_api"])

    def test_plumbing_only_is_trivial_and_can_be_stamped(self):
        self.write("apps/api/src/modules/widgets/widgets.module.ts", "export class WidgetsModule {}\n")
        self.write("apps/web/src/features/widgets/index.ts", "export {};\n")
        d = json.loads(self.script("detect_scope.py").stdout)
        self.assertFalse(d["surface"])
        r = self.script("detect_scope.py", "--stamp-if-trivial")
        self.assertIn("skipped", r.stdout)
        self.assertEqual(self.gate().stdout.strip(), "")

    def test_skip_with_a_surface_needs_the_users_words(self):
        self.write("apps/api/src/modules/widgets/widgets.controller.ts", CONTROLLER)
        r = self.script("stamp.py", "write", "--status", "skipped")
        self.assertEqual(r.returncode, 3)
        self.assertIn("block", self.gate().stdout)
        r = self.script("stamp.py", "write", "--status", "skipped", "--user-approved", "skip the parity check this time")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.gate().stdout.strip(), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
