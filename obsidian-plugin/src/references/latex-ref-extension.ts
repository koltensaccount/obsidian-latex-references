import { RangeSetBuilder, StateEffect, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type LatexReferencesPlugin from "../main";
import {
  findLatexReferenceAtPosition,
  getReferenceStatus,
  getStatusLabel,
  parseLatexReferences,
  type ParsedLatexReference
} from "../../../reference-core/src/index";

export const manifestRefreshEffect = StateEffect.define<number>();

const parsedDocCache = new WeakMap<Text, ParsedLatexReference[]>();

const SINGLE_CLICK_OPEN_DELAY_MS = 190;
const MAX_CLICK_DRAG_PX = 4;

export function getCachedParsedLatexRefs(doc: Text): ParsedLatexReference[] {
  let cached = parsedDocCache.get(doc);
  if (!cached) {
    cached = parseLatexReferences(doc.toString());
    parsedDocCache.set(doc, cached);
  }
  return cached;
}

function isPointInClientRects(rects: DOMRectList, x: number, y: number, pad = 2): boolean {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.width === 0 && r.height === 0) continue;
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
      return true;
    }
  }
  return false;
}

function resolveClickedGardenref(view: EditorView, event: MouseEvent): ParsedLatexReference | null {
  const targetNode = event.target as Node | null;
  const targetEl = targetNode instanceof Element ? targetNode : targetNode?.parentElement;
  if (!targetEl || !view.contentDOM.contains(targetEl)) {
    return null;
  }

  const refs = getCachedParsedLatexRefs(view.state.doc);
  if (refs.length === 0) {
    return null;
  }

  const gardenrefEl = targetEl.closest(".cm-gardenref") as HTMLElement | null;
  if (gardenrefEl) {
    if (!isPointInClientRects(gardenrefEl.getClientRects(), event.clientX, event.clientY, 2)) {
      return null;
    }
    const fromAttr = gardenrefEl.getAttribute("data-gardenref-from");
    if (fromAttr !== null) {
      const expectedFrom = Number.parseInt(fromAttr, 10);
      const exact = refs.find((r) => r.from === expectedFrom);
      if (exact) return exact;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (pos === null) return null;
    return findLatexReferenceAtPosition(refs, pos, true);
  }

  // Fallback for clicks landing directly on a LaTeX Live rendered widget (e.g. inline math inside arg 2)
  const renderWidgetEl = targetEl.closest(".lsp-lp-render") as HTMLElement | null;
  if (renderWidgetEl && isPointInClientRects(renderWidgetEl.getClientRects(), event.clientX, event.clientY, 2)) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (pos !== null) {
      return findLatexReferenceAtPosition(refs, pos, false);
    }
  }

  return null;
}

function buildGardenrefDecorations(view: EditorView, plugin: LatexReferencesPlugin): DecorationSet {
  const refs = getCachedParsedLatexRefs(view.state.doc);
  if (refs.length === 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const addedFrom = new Set<number>();

  for (const ref of refs) {
    if (ref.from >= ref.to) continue;
    // Check overlap with at least one visible range
    let visible = false;
    for (const range of view.visibleRanges) {
      if (ref.to > range.from && ref.from < range.to) {
        visible = true;
        break;
      }
    }
    if (!visible || addedFrom.has(ref.from)) continue;
    addedFrom.add(ref.from);

    const status = getReferenceStatus(plugin.referencesManifest, ref.id);
    const statusLabel = getStatusLabel(status);
    const deco = Decoration.mark({
      class: `cm-gardenref is-${status}`,
      attributes: {
        "data-gardenref-from": String(ref.from),
        "data-gardenref-id": ref.id,
        title: `Reference ^${ref.id} (${statusLabel}) — Click to manage`
      }
    });
    builder.add(ref.from, ref.to, deco);
  }

  return builder.finish();
}

interface PendingMouseDown {
  x: number;
  y: number;
  time: number;
  refFrom: number;
}

export function createLatexReferenceInteractiveExtension(plugin: LatexReferencesPlugin): Extension {
  const viewPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private view: EditorView;
      private unsubscribe: () => void;
      private pendingDown: PendingMouseDown | null = null;
      private pendingOpenTimer: number | null = null;
      private destroyed = false;

      constructor(view: EditorView) {
        this.view = view;
        this.decorations = buildGardenrefDecorations(view, plugin);
        this.unsubscribe = plugin.onManifestChanged(() => {
          if (this.destroyed) return;
          requestAnimationFrame(() => {
            if (!this.destroyed && this.view.dom.isConnected) {
              this.view.dispatch({ effects: manifestRefreshEffect.of(Date.now()) });
            }
          });
        });
      }

      clearPending(): void {
        this.pendingDown = null;
        if (this.pendingOpenTimer !== null) {
          window.clearTimeout(this.pendingOpenTimer);
          this.pendingOpenTimer = null;
        }
      }

      handleMouseDown(event: MouseEvent): void {
        this.clearPending();
        // Never intercept modified clicks (Shift selection, Alt, Ctrl context menu, Cmd SyncTeX/multicursor)
        // and never schedule click-open on multi-click (double/triple-click selection)
        if (
          event.button !== 0 ||
          event.altKey ||
          event.shiftKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.detail > 1
        ) {
          return;
        }
        const clickedRef = resolveClickedGardenref(this.view, event);
        if (!clickedRef) {
          return;
        }
        this.pendingDown = {
          x: event.clientX,
          y: event.clientY,
          time: Date.now(),
          refFrom: clickedRef.from
        };
      }

      handleMouseUp(event: MouseEvent): void {
        const down = this.pendingDown;
        this.pendingDown = null;
        if (!down) return;

        if (
          event.button !== 0 ||
          event.altKey ||
          event.shiftKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.detail !== 1
        ) {
          return;
        }

        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > MAX_CLICK_DRAG_PX) {
          return;
        }

        // Preserve drag selections without hijacking
        if (!this.view.state.selection.main.empty) {
          return;
        }

        const clickedRef = resolveClickedGardenref(this.view, event);
        if (!clickedRef || clickedRef.from !== down.refFrom) {
          return;
        }

        const expectedFrom = clickedRef.from;
        const expectedRaw = clickedRef.raw;

        this.pendingOpenTimer = window.setTimeout(() => {
          this.pendingOpenTimer = null;
          if (this.destroyed || !this.view.dom.isConnected) return;
          // Do not open if the user began selecting, double-clicked, or another modal is open
          if (!this.view.state.selection.main.empty) return;
          if (document.querySelector(".modal-container")) return;

          const latestRefs = getCachedParsedLatexRefs(this.view.state.doc);
          const currentRef = latestRefs.find((r) => r.from === expectedFrom && r.raw === expectedRaw);
          if (!currentRef) return;

          void plugin.openModalForExistingReference(this.view, currentRef);
        }, SINGLE_CLICK_OPEN_DELAY_MS);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.clearPending();
        }
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some((tr) => tr.effects.some((e) => e.is(manifestRefreshEffect)))
        ) {
          this.decorations = buildGardenrefDecorations(update.view, plugin);
        }
      }

      destroy(): void {
        this.destroyed = true;
        this.clearPending();
        this.unsubscribe();
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(event) {
          this.handleMouseDown(event);
          return false;
        },
        mouseup(event) {
          this.handleMouseUp(event);
          return false;
        },
        keydown() {
          this.clearPending();
          return false;
        },
        dragstart() {
          this.clearPending();
          return false;
        },
        blur() {
          this.clearPending();
          return false;
        }
      }
    }
  );

  return viewPlugin;
}
