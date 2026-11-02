import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme, focused, panes, spaces, window, layout, run, props, settings } from "herdr";

// Pills for the focused terminal's GitHub repo and its branch's PR.
// The remote is read where the terminal runs (its space's machine);
// the PR is looked up here with the person's own `gh` login.
const PR_EVERY = 2 * 60 * 1000;
const PAD = 10; // right padding, matching the tab bar's

// git@github.com:o/r.git, https://github.com/o/r, ssh://git@github.com/o/r,
// and ssh host aliases like github.com-work:o/r.
function parseRemote(url) {
  const m = url.trim().match(/github\.com[^:/]*[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export default class GithubLink extends View {
  init(_props, cx) {
    this.repos = {};   // "machine|cwd" -> "owner/repo" | null
    this.prs = {};     // "owner/repo|branch" -> { number, url, state, isDraft } | null
    this.busy = new Set();
    cx.timer.every(PR_EVERY, (cx) => {
      for (const k of Object.keys(this.prs)) delete this.prs[k];
      cx.notify();
    });
  }

  where() {
    const f = focused();
    if (!f?.cwd) return null;
    const pane = f.pane && panes().find((p) => p.pane === f.pane);
    const space = spaces().find((s) => s.id === f.space);
    return { cwd: f.cwd, branch: pane?.branch ?? null, machine: space?.machine ?? null };
  }

  lookupRepo(cx, key, w) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", ["remote", "get-url", "origin"], { cwd: w.cwd, on: w.machine });
        this.repos[key] = r.code === 0 ? parseRemote(r.stdout) : null;
      } catch { this.repos[key] = null; }
      this.busy.delete(key);
      cx.notify();
    });
  }

  lookupPr(cx, key, repo, branch) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["pr", "list", "--repo", repo, "--head", branch, "--state", "all",
          "--limit", "1", "--json", "number,url,state,isDraft"]);
        this.prs[key] = r.code === 0 ? (JSON.parse(r.stdout)[0] ?? null) : null;
      } catch { this.prs[key] = null; }
      this.busy.delete(key);
      cx.notify();
    });
  }

  open(url) {
    exec(window()?.platform === "macos" ? "open" : "xdg-open", [url]).catch(() => {});
  }

  pill(t, id, tip, url, kids) {
    return h_flex().id(id).h(26).px(8).gap(6).flex_none().items_center().rounded(6)
      .text_size(12).text_color(t.muted).bg(t.chrome).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // don't drag the window
      .on_click((_e, cx) => { cx.stop_propagation(); this.open(url); })
      .children(kids);
  }

  // The block hugs its pills so they sit right after the tab bar's own
  // buttons: resize our layout node to the pills' width (+ right padding).
  fit(width) {
    const id = props()?.block ?? "github";
    const find = (n) => n?.id === id ? n : (n?.children ?? []).map(find).find(Boolean);
    const node = find(layout());
    const want = Math.max(0, Math.round(width / (settings().zoom || 1)) + (width > 0 ? PAD : 0));
    if (node && Math.abs((node.size?.px ?? -1) - want) > 1) run("layout.resize", { id, px: want });
  }

  render(cx) {
    const t = theme();
    const pills = h_flex().id("pills").flex_none().h_full().gap(3).items_center()
      .on_size_change((size, _cx) => this.fit(size.width));
    const row = (inner = pills) => h_flex().size_full().min_w(0).items_center()
      .bg(t.chrome).border_b(1).border_color(t.border).child(inner);
    const w = this.where();
    if (!w) return row();

    const rkey = `${w.machine ?? ""}|${w.cwd}`;
    if (!(rkey in this.repos)) { this.lookupRepo(cx, rkey, w); return row(); }
    const repo = this.repos[rkey];
    if (!repo) return row();

    const repoUrl = `https://github.com/${repo}`;
    let pr = null;
    if (w.branch) {
      const pkey = `${repo}|${w.branch}`;
      if (!(pkey in this.prs)) this.lookupPr(cx, pkey, repo, w.branch);
      pr = this.prs[pkey] ?? null;
    }
    const dot = !pr ? null
      : pr.isDraft ? t.dim
      : pr.state === "OPEN" ? t.ansi2
      : pr.state === "MERGED" ? t.ansi5
      : t.dim;

    return row(pills
      .child(this.pill(t, "gh-repo", repoUrl, repoUrl, [
        svg("mods/github-link/github.svg").size(14).flex_none(),
        div().max_w(160).truncate().child(repo.split("/")[1]),
      ]))
      .when(Boolean(pr), (el) => el.child(this.pill(t, "gh-pr", `${pr.url}${pr.isDraft ? " (draft)" : ` (${pr.state.toLowerCase()})`}`, pr.url, [
        div().size(7).rounded(4).flex_none().bg(dot),
        div().child(`#${pr.number}`),
      ]))));
  }
}
