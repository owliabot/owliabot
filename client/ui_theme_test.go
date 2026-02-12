package main

import (
	"strings"
	"testing"
)

func TestModernGrayPalette(t *testing.T) {
	if ansiBlue != "\033[38;5;250m" {
		t.Fatalf("ansiBlue should use modern gray tone, got %q", ansiBlue)
	}
	if ansiCyan != "\033[38;5;252m" {
		t.Fatalf("ansiCyan should use light gray tone, got %q", ansiCyan)
	}
	if ansiGreen != "\033[38;5;247m" {
		t.Fatalf("ansiGreen should use neutral gray highlight, got %q", ansiGreen)
	}
	if ansiYellow != "\033[38;5;245m" {
		t.Fatalf("ansiYellow should use muted gray accent, got %q", ansiYellow)
	}
}

func TestBuildLogoLinesUsesPixelStyle(t *testing.T) {
	lines := buildLogoLines(170, 0)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "█") {
		t.Fatalf("logo should use solid block glyphs, got:\n%s", joined)
	}
}

func TestBuildPixelWordLinesHasVisibleInterGlyphGap(t *testing.T) {
	lines := buildPixelWordLines("OO", ansiCyan, ansiDim, 2)
	if len(lines) == 0 {
		t.Fatalf("expected non-empty pixel lines")
	}
	row := stripANSI(lines[0])
	if !hasInterGlyphGap(row, 2) {
		t.Fatalf("expected visible gap between glyphs, got row: %q", row)
	}
}

func TestBuildLogoLinesUsesCompactModeOnNormalWidth(t *testing.T) {
	lines := buildLogoLines(120, 0)
	if len(lines) == 0 {
		t.Fatalf("expected logo lines")
	}
	joined := strings.Join(lines, "\n")
	if strings.Contains(joined, "╭") || strings.Contains(joined, "╮") || strings.Contains(joined, "╰") || strings.Contains(joined, "╯") {
		t.Fatalf("logo area should not include neon border frame, got:\n%s", joined)
	}
	if strings.Contains(joined, "DOCKER ONBOARD") || strings.Contains(joined, "Go Wizard") {
		t.Fatalf("logo area should not include subtitle text, got:\n%s", joined)
	}
}

func TestBuildLogoLinesUsesHeroModeOnWideTerminals(t *testing.T) {
	lines := buildLogoLines(170, 0)
	if len(lines) < 5 {
		t.Fatalf("expected hero logo to use multiline ascii banner, got %d", len(lines))
	}
}

func TestBuildLogoLinesUsesNeonRGBColors(t *testing.T) {
	lines := buildLogoLines(170, 0)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "\x1b[38;2;") {
		t.Fatalf("expected neon truecolor escape sequences, got:\n%s", joined)
	}
}

func TestBuildLogoLinesUsesBrandIndigoColor(t *testing.T) {
	lines := buildLogoLines(170, 0)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "\x1b[38;2;79;70;229m") {
		t.Fatalf("expected brand indigo color #4f46e5 in logo, got:\n%s", joined)
	}
}

func TestBuildLogoLinesKeepsStableColorsAcrossFrames(t *testing.T) {
	a := strings.Join(buildLogoLines(170, 0), "\n")
	b := strings.Join(buildLogoLines(170, 9), "\n")
	if a != b {
		t.Fatalf("logo should not rotate colors across frames")
	}
}

func TestBuildLogoLinesUsesBoldBrandGlyphs(t *testing.T) {
	lines := buildLogoLines(170, 0)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, ansiBold) {
		t.Fatalf("expected bold style in brand logo, got:\n%s", joined)
	}
}

func TestBuildLogoLinesUsesWiderInterLetterSpacing(t *testing.T) {
	lines := buildLogoLines(170, 0)
	rowWithGlyph := ""
	for _, row := range lines {
		if strings.Contains(row, "█") {
			rowWithGlyph = stripANSI(row)
			break
		}
	}
	if rowWithGlyph == "" {
		t.Fatalf("expected solid glyph rows in logo")
	}
	if !hasInterGlyphGap(rowWithGlyph, 2) {
		t.Fatalf("expected inter-letter gap in solid logo row, got %q", rowWithGlyph)
	}
}

func TestBuildSolidWordLinesProducesSolidGlyphs(t *testing.T) {
	lines := buildSolidWordLines("OwliaBot", 1)
	if len(lines) == 0 {
		t.Fatalf("expected non-empty solid glyph lines")
	}
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "█") {
		t.Fatalf("expected solid block glyphs, got:\n%s", joined)
	}
	if strings.Contains(joined, "_") {
		t.Fatalf("solid banner should not use outline ascii underscores, got:\n%s", joined)
	}
}

func TestBuildLogoLinesSmallWidthUsesBrandCase(t *testing.T) {
	lines := buildLogoLines(40, 0)
	joined := stripANSI(strings.Join(lines, "\n"))
	if !strings.Contains(joined, "OwliaBot") {
		t.Fatalf("expected small-width fallback brand text OwliaBot, got:\n%s", joined)
	}
}

func hasInterGlyphGap(line string, minGap int) bool {
	trimmed := strings.TrimSpace(line)
	inBlock := false
	gap := 0
	seenBlock := false
	for _, r := range trimmed {
		if r == '█' || r == '▓' {
			if seenBlock && gap >= minGap {
				return true
			}
			inBlock = true
			seenBlock = true
			gap = 0
			continue
		}
		if inBlock || seenBlock {
			gap++
		}
		inBlock = false
	}
	return false
}
