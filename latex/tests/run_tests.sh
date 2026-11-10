#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LATEX_DIR="$(dirname "$DIR")"

echo "=== Running LaTeX Package Verification Tests ==="

# 1. Normal compilation with manifest
cat << 'EOF' > "$DIR/test_normal.tex"
\pdfcompresslevel=0
\pdfobjcompresslevel=0
\documentclass{article}
\usepackage{../gardenref}

\declaregardenref{def-group-homomorphism}{https://obsidian.koltensserver.com/latex-references/def-group-homomorphism/}
\declaregardenref{thm-lagrange}{https://obsidian.koltensserver.com/latex-references/thm-lagrange/}

\begin{document}
Let $f$ be a \gardenref{def-group-homomorphism}{homomorphism}.
We also use \gardenref{def-group-homomorphism}{repeated homomorphism} here.
Math reference: \gardenref{def-group-homomorphism}{$\varphi: G \to G'$}.
Theorem reference: \gardenref{thm-lagrange}{Lagrange's Theorem}.
Unpublished reference: \gardenref{def-missing}{some missing concept}.
\end{document}
EOF

cd "$DIR"
/Library/TeX/texbin/pdflatex -interaction=nonstopmode test_normal.tex > test_normal.build.log

# Check that def-missing triggered a warning
grep "Reference target 'def-missing' is unpublished" test_normal.build.log >/dev/null || (echo "FAILED: Missing warning for unpublished ref" && exit 1)

# Check that PDF contains the expected hyperlinks
grep -a "https://obsidian.koltensserver.com/latex-references/def-group-homomorphism/" test_normal.pdf >/dev/null || (echo "FAILED: Missing URI in PDF" && exit 1)
grep -a "https://obsidian.koltensserver.com/latex-references/thm-lagrange/" test_normal.pdf >/dev/null || (echo "FAILED: Missing URI in PDF" && exit 1)

# Ensure def-missing does not appear as a link
if grep -a "latex-references/def-missing" test_normal.pdf >/dev/null; then
  echo "FAILED: Unpublished reference was linked!"
  exit 1
fi

echo "✓ Normal compilation and URL verification passed"

# 2. Draft mode verification
cat << 'EOF' > "$DIR/test_draft.tex"
\pdfcompresslevel=0
\pdfobjcompresslevel=0
\documentclass{article}
\usepackage[draft]{../gardenref}

\declaregardenref{def-group-homomorphism}{https://obsidian.koltensserver.com/latex-references/def-group-homomorphism/}

\begin{document}
Draft text: \gardenref{def-group-homomorphism}{homomorphism}.
\end{document}
EOF

/Library/TeX/texbin/pdflatex -interaction=nonstopmode test_draft.tex > test_draft.build.log
if grep -a "latex-references" test_draft.pdf >/dev/null; then
  echo "FAILED: Draft mode still contained links!"
  exit 1
fi

echo "✓ Draft mode verification passed"

# 3. Compatibility when hyperref is loaded BEFORE gardenref
cat << 'EOF' > "$DIR/test_preloaded_hyperref.tex"
\pdfcompresslevel=0
\pdfobjcompresslevel=0
\documentclass{article}
\usepackage[colorlinks=true, urlcolor=red]{hyperref}
\usepackage{../gardenref}

\declaregardenref{def-group-homomorphism}{https://obsidian.koltensserver.com/latex-references/def-group-homomorphism/}

\begin{document}
Preloaded hyperref: \gardenref{def-group-homomorphism}{homomorphism}.
\end{document}
EOF

/Library/TeX/texbin/pdflatex -interaction=nonstopmode test_preloaded_hyperref.tex > test_preloaded.build.log
grep -a "https://obsidian.koltensserver.com/latex-references/def-group-homomorphism/" test_preloaded_hyperref.pdf >/dev/null || (echo "FAILED: Preloaded hyperref URI missing" && exit 1)

echo "✓ Preloaded hyperref compatibility passed"

# 4. Overleaf / Standalone portability without gardenref.sty or gardenrefs.tex
cat << 'EOF' > "$DIR/test_overleaf_portable.tex"
\pdfcompresslevel=0
\pdfobjcompresslevel=0
\documentclass{article}
\IfFileExists{gardenref.sty}{\usepackage{gardenref}}{}
\providecommand{\gardenref}[2]{#2}
\providecommand{\declaregardenref}[2]{}
\providecommand{\setgardenrefbase}[1]{}
\begin{document}
Plain text: \gardenref{def-group-homomorphism}{homomorphism}.
Math and braces: \gardenref{def-isomorphism}{$\varphi: G \to G'$ and \emph{nested \textbf{braces}} $\{a, b\}$}.
Unknown target: \gardenref{def-nonexistent}{missing concept}.
\end{document}
EOF

OVERLEAF_TMP="$(mktemp -d /tmp/overleaf-portable-test.XXXXXX)"
cp "$DIR/test_overleaf_portable.tex" "$OVERLEAF_TMP/"
(
  cd "$OVERLEAF_TMP"
  TEXMFHOME=/tmp/nonexistent-gardenref-texmf /Library/TeX/texbin/pdflatex -interaction=nonstopmode test_overleaf_portable.tex > test_overleaf_portable.build.log
)

if grep -E "gardenref|Digital Garden|Undefined control sequence|File .* not found" "$OVERLEAF_TMP/test_overleaf_portable.build.log" >/dev/null; then
  echo "FAILED: Overleaf fallback log contained unexpected warnings/errors!"
  cat "$OVERLEAF_TMP/test_overleaf_portable.build.log"
  rm -rf "$OVERLEAF_TMP"
  exit 1
fi

if grep -aE "def-group-homomorphism|def-isomorphism|def-nonexistent|latex-references" "$OVERLEAF_TMP/test_overleaf_portable.pdf" >/dev/null; then
  echo "FAILED: Overleaf fallback PDF leaked reference IDs or URLs!"
  rm -rf "$OVERLEAF_TMP"
  exit 1
fi

if command -v gs >/dev/null 2>&1; then
  EXTRACTED_TXT="$(gs -q -dNOPAUSE -dBATCH -sDEVICE=txtwrite -sOutputFile=- "$OVERLEAF_TMP/test_overleaf_portable.pdf")"
  echo "$EXTRACTED_TXT" | grep -q "homomorphism" || (echo "FAILED: Overleaf PDF missing display text 'homomorphism'" && rm -rf "$OVERLEAF_TMP" && exit 1)
  echo "$EXTRACTED_TXT" | grep -q "braces" || (echo "FAILED: Overleaf PDF missing nested braces display text" && rm -rf "$OVERLEAF_TMP" && exit 1)
  echo "$EXTRACTED_TXT" | grep -q "missing concept" || (echo "FAILED: Overleaf PDF missing unknown ref display text" && rm -rf "$OVERLEAF_TMP" && exit 1)
fi
rm -rf "$OVERLEAF_TMP"
echo "✓ Overleaf standalone portability without gardenref.sty passed"

# Clean up build artifacts
rm -f "$DIR"/*.aux "$DIR"/*.log "$DIR"/*.out "$DIR"/*.pdf "$DIR"/test_*.tex "$DIR"/*.build.log

echo "=== All LaTeX Package Tests Passed! ==="
