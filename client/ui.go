package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss"
	zone "github.com/lrstanley/bubblezone"
)

const (
	ansiReset  = "\033[0m"
	ansiBold   = "\033[1m"
	ansiDim    = "\033[38;5;242m"
	ansiBlue   = "\033[38;5;250m"
	ansiCyan   = "\033[38;5;252m"
	ansiGreen  = "\033[38;5;247m"
	ansiYellow = "\033[38;5;245m"
	ansiRed    = "\033[38;5;246m"
)

var uiRenderFrame int

type uiStyles struct {
	Section      lipgloss.Style
	SectionBold  lipgloss.Style
	Primary      lipgloss.Style
	Secondary    lipgloss.Style
	Muted        lipgloss.Style
	Detail       lipgloss.Style
	Success      lipgloss.Style
	Warning      lipgloss.Style
	Error        lipgloss.Style
	QuestionHead lipgloss.Style
	SelectedLine lipgloss.Style
	ProgressFill []lipgloss.Style
	ProgressRest lipgloss.Style
}

var styles = uiStyles{
	Section:      lipgloss.NewStyle().Foreground(lipgloss.Color("250")),
	SectionBold:  lipgloss.NewStyle().Foreground(lipgloss.Color("252")).Bold(true),
	Primary:      lipgloss.NewStyle().Foreground(lipgloss.Color("252")),
	Secondary:    lipgloss.NewStyle().Foreground(lipgloss.Color("250")),
	Muted:        lipgloss.NewStyle().Foreground(lipgloss.Color("242")),
	Detail:       lipgloss.NewStyle().Foreground(lipgloss.Color("242")),
	Success:      lipgloss.NewStyle().Foreground(lipgloss.Color("247")),
	Warning:      lipgloss.NewStyle().Foreground(lipgloss.Color("245")),
	Error:        lipgloss.NewStyle().Foreground(lipgloss.Color("246")),
	QuestionHead: lipgloss.NewStyle().Foreground(lipgloss.Color("233")).Background(lipgloss.Color("250")).Bold(true),
	SelectedLine: lipgloss.NewStyle().Foreground(lipgloss.Color("255")).Background(lipgloss.Color("238")).Bold(true),
	ProgressFill: []lipgloss.Style{
		lipgloss.NewStyle().Background(lipgloss.Color("252")),
		lipgloss.NewStyle().Background(lipgloss.Color("251")),
		lipgloss.NewStyle().Background(lipgloss.Color("250")),
		lipgloss.NewStyle().Background(lipgloss.Color("249")),
	},
	ProgressRest: lipgloss.NewStyle().Background(lipgloss.Color("238")),
}

type popupView struct {
	StepIndex      int
	TotalSteps     int
	StepTitle      string
	Steps          []string
	HeadlineLabel  string
	Question       string
	ContextLines   []string
	Highlights     []string
	Options        []string
	OptionDetails  []string
	Recommended    int
	InputHint      string
	InputValue     string
	SelectedOption int
	ErrorText      string
	Spinner        string
	DisableInput   bool
	LineMode       bool
	ShowHelp       bool
}

type popupLayout struct {
	Lines       []string
	TopPad      int
	LeftPad     int
	OuterWidth  int
	InputAbsRow int
	InputAbsCol int
}

type footerLayout struct {
	Rows      []string
	InputRow  int
	InputCol  int
	HasPrompt bool
}

func renderPopup(view popupView) {
	cols, rows := terminalSize()
	layout := composePopup(view, cols, rows)

	fmt.Print("\033[2J\033[H")
	pad := strings.Repeat(" ", layout.LeftPad)
	paddedLines := make([]string, 0, len(layout.Lines))
	for _, line := range layout.Lines {
		paddedLines = append(paddedLines, pad+line)
	}
	output := strings.Repeat("\n", layout.TopPad) + strings.Join(paddedLines, "\n")
	fmt.Print(zone.Scan(output))

	if layout.InputAbsRow > 0 && layout.InputAbsCol > 0 {
		moveCursor(layout.InputAbsRow, layout.InputAbsCol)
	}
}

func composePopup(view popupView, cols, rows int) popupLayout {
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 40
	}

	maxWidth := maxInt(56, cols-6)
	outerWidth := minInt(124, maxWidth)
	if cols < 76 {
		outerWidth = maxInt(44, cols-2)
	}
	if outerWidth > cols {
		outerWidth = cols
	}
	if outerWidth < 44 {
		outerWidth = 44
	}

	innerWidth := maxInt(40, outerWidth-2)

	leftWidth := clamp(20, innerWidth/3, 34)
	rightWidth := innerWidth - leftWidth - 1
	if rightWidth < 24 {
		rightWidth = 24
		leftWidth = innerWidth - rightWidth - 1
		if leftWidth < 16 {
			leftWidth = 16
			rightWidth = innerWidth - leftWidth - 1
		}
	}

	maxContextLines := clamp(2, rows/10, 6)
	maxHighlightLines := clamp(3, rows/8, 8)

	leftLines := buildStepColumn(view.Steps, view.StepIndex, view.StepTitle, leftWidth)
	rightLines := buildRightColumn(view, rightWidth, maxContextLines, maxHighlightLines)
	maxRows := maxInt(len(leftLines), len(rightLines))

	fancyCards := len(view.Options) > 6 && rows >= 38 && innerWidth >= 96
	footer := buildFooterLayout(view, innerWidth, fancyCards)

	logo := buildLogoLines(innerWidth, uiRenderFrame)
	uiRenderFrame++

	lines := make([]string, 0, 18+maxRows+len(footer.Rows))
	lines = append(lines, boxTop(innerWidth))
	for _, line := range logo {
		lines = append(lines, boxRow(innerWidth, line))
	}
	lines = append(lines, boxSplit(leftWidth, rightWidth))
	for i := 0; i < maxRows; i++ {
		left := ""
		right := ""
		if i < len(leftLines) {
			left = leftLines[i]
		}
		if i < len(rightLines) {
			right = rightLines[i]
		}
		lines = append(lines, boxSplitRow(leftWidth, rightWidth, left, right))
	}
	lines = append(lines, boxMid(innerWidth))

	inputLineIndex := -1
	for i, row := range footer.Rows {
		if footer.HasPrompt && i == footer.InputRow {
			inputLineIndex = len(lines)
		}
		lines = append(lines, boxRow(innerWidth, row))
	}
	lines = append(lines, boxBottom(innerWidth))
	lines = normalizePopupLineWidths(lines, innerWidth+2)

	topPad := maxInt(0, (rows-len(lines))/4)
	leftPad := maxInt(0, (cols-outerWidth)/2)

	inputAbsRow := 0
	inputAbsCol := 0
	if inputLineIndex >= 0 {
		inputAbsRow = topPad + inputLineIndex + 1
		inputAbsCol = leftPad + 2 + footer.InputCol
	}

	return popupLayout{
		Lines:       lines,
		TopPad:      topPad,
		LeftPad:     leftPad,
		OuterWidth:  outerWidth,
		InputAbsRow: inputAbsRow,
		InputAbsCol: inputAbsCol,
	}
}

func normalizePopupLineWidths(lines []string, width int) []string {
	if width <= 0 || len(lines) == 0 {
		return lines
	}
	out := make([]string, len(lines))
	for i, line := range lines {
		out[i] = padVisual(line, width)
	}
	return out
}

func buildStepColumn(steps []string, active int, stepTitle string, width int) []string {
	if len(steps) == 0 {
		steps = []string{"Welcome", "Provider", "Channels", "MCP", "Review", "Apply"}
	}
	lines := []string{
		styles.Section.Render(" Progress"),
		renderProgressMeta(steps, active, stepTitle),
		renderProgressBar(steps, active, width),
		"",
		styles.Section.Render(" Journey"),
		"",
	}
	for i, step := range steps {
		status := styles.Muted.Render("·")
		labelStyle := styles.Secondary
		if i < active {
			status = styles.Success.Render("✓")
		} else if i == active {
			status = styles.Primary.Render("▶")
			labelStyle = styles.SectionBold
		}
		label := fmt.Sprintf("%s %s %s", status, styles.Muted.Render(fmt.Sprintf("%d.", i+1)), labelStyle.Render(step))
		lines = append(lines, markMultiline(journeyZoneID(i), padVisual(label, width))...)
	}
	for i := range lines {
		if strings.Contains(lines[i], "\x1b[9000;") {
			continue
		}
		lines[i] = padVisual(lines[i], width)
	}
	return lines
}

func renderProgressMeta(steps []string, active int, stepTitle string) string {
	total := len(steps)
	if total <= 0 {
		total = 1
	}
	current := active + 1
	if current < 1 {
		current = 1
	}
	if current > total {
		current = total
	}
	if strings.TrimSpace(stepTitle) == "" && active >= 0 && active < len(steps) {
		stepTitle = steps[active]
	}
	if strings.TrimSpace(stepTitle) == "" {
		stepTitle = "Setup"
	}
	return styles.Muted.Render(fmt.Sprintf("Step %d of %d · %s", current, total, stepTitle))
}

func renderProgressBar(steps []string, active int, width int) string {
	total := len(steps)
	if total <= 0 {
		total = 1
	}
	current := active + 1
	if current < 1 {
		current = 1
	}
	if current > total {
		current = total
	}
	barWidth := width - 2
	if barWidth < 8 {
		barWidth = 8
	}
	filledCount := int(math.Round((float64(current) / float64(total)) * float64(barWidth)))
	if filledCount < 1 {
		filledCount = 1
	}
	if filledCount > barWidth {
		filledCount = barWidth
	}
	filled := renderGradientFill(filledCount)
	rest := styles.ProgressRest.Render(strings.Repeat(" ", barWidth-filledCount))
	return filled + rest
}

func renderGradientFill(width int) string {
	if width <= 0 {
		return ""
	}
	palette := styles.ProgressFill
	if len(palette) == 0 {
		return strings.Repeat(" ", width)
	}
	if len(palette) == 1 {
		return palette[0].Render(strings.Repeat(" ", width))
	}

	var b strings.Builder
	last := width - 1
	if last <= 0 {
		return palette[0].Render(" ")
	}
	for i := 0; i < width; i++ {
		index := int(math.Round((float64(i) / float64(last)) * float64(len(palette)-1)))
		if index < 0 {
			index = 0
		}
		if index >= len(palette) {
			index = len(palette) - 1
		}
		b.WriteString(palette[index].Render(" "))
	}
	return b.String()
}

func buildRightColumn(view popupView, width int, maxContext int, maxHighlights int) []string {
	_ = maxContext
	lines := []string{styles.Section.Render(" Assistant"), ""}
	question := strings.TrimSpace(view.Question)
	if question == "" {
		question = "Let's continue setup."
	}
	headlineLabel := strings.ToUpper(strings.TrimSpace(view.HeadlineLabel))
	switch headlineLabel {
	case "ACTION", "STATUS", "QUESTION":
		headlineLabel = " " + headlineLabel + " "
	default:
		headlineLabel = " QUESTION "
		if view.DisableInput {
			headlineLabel = " STATUS "
		}
	}
	lines = append(lines, styles.QuestionHead.Render(headlineLabel))
	for _, line := range wrapText(styles.SectionBold.Render(question), maxInt(8, width-2)) {
		lines = append(lines, "  "+line)
	}
	if view.Spinner != "" {
		for _, line := range wrapText(styles.Warning.Render(view.Spinner), width) {
			lines = append(lines, line)
		}
	}

	keyContext := selectHighlights(view.Highlights, minInt(5, maxHighlights))
	if len(keyContext) > 0 {
		lines = append(lines, "")
		lines = append(lines, styles.Section.Render(" Key Notes"))
		for _, h := range keyContext {
			for _, line := range wrapText(styles.Muted.Render("• "+h), width) {
				lines = append(lines, line)
			}
		}
	}

	if view.ShowHelp {
		lines = append(lines, "")
		lines = append(lines, styles.Section.Render(" Help"))
		help := "Use ↑/↓ to select, Enter to confirm, Esc to go back, or type a number as a shortcut."
		if view.LineMode {
			help = "Type up/down or a number, then press Enter to confirm. Type back to return."
		}
		for _, line := range wrapText(help, width) {
			lines = append(lines, line)
		}
	}
	for i := range lines {
		lines[i] = padVisual(lines[i], width)
	}
	return lines
}

func buildFooterLines(view popupView, width int) []string {
	return buildFooterLayout(view, width, true).Rows
}

func buildFooterLayout(view popupView, width int, fancyCards bool) footerLayout {
	rows := []string{}
	if len(view.Options) > 0 {
		rows = append(rows, styles.Section.Render(" Options"))
		for i, opt := range view.Options {
			selected := view.SelectedOption == i
			detail := ""
			if i < len(view.OptionDetails) {
				detail = view.OptionDetails[i]
			}
			recommended := view.Recommended == i
			if fancyCards {
				cardLines := renderOptionCardLines(i+1, opt, detail, width, selected, recommended)
				rows = append(rows, markMultiline(optionZoneID(i), strings.Join(cardLines, "\n"))...)
				continue
			}
			prefix := "  "
			if selected {
				prefix = "▌ "
			}
			optionText := fmt.Sprintf("[%d] %s", i+1, opt)
			if recommended {
				optionText += " ★ Recommended"
			}

			optionWidth := width - visibleLen(prefix)
			if optionWidth < 8 {
				optionWidth = 8
			}
			plainLines := []string{}
			for _, wrapped := range wrapText(optionText, optionWidth) {
				styled := styles.Primary.Render(wrapped)
				if selected {
					styled = styles.SelectedLine.Render(wrapped)
				}
				plainLines = append(plainLines, prefix+styled)
			}

			if strings.TrimSpace(detail) != "" {
				detailPrefix := "  "
				detailWidth := width - visibleLen(detailPrefix)
				if detailWidth < 8 {
					detailWidth = 8
				}
				for _, wrapped := range wrapText(detail, detailWidth) {
					plainLines = append(plainLines, detailPrefix+styles.Detail.Render(wrapped))
				}
			}
			for _, plain := range plainLines {
				rows = append(rows, zone.Mark(optionZoneID(i), plain))
			}
		}
	}
	if view.ErrorText != "" {
		if !isInputReconnectNotice(view.ErrorText) {
			for _, wrapped := range wrapText(styles.Error.Render(" "+view.ErrorText), width) {
				rows = append(rows, wrapped)
			}
		}
	}

	hint := strings.TrimSpace(view.InputHint)
	if hint == "" {
		hint = "Type number and press Enter"
	}
	for _, wrapped := range wrapText(styles.Muted.Render(" "+hint), width) {
		rows = append(rows, wrapped)
	}
	if !view.DisableInput {
		inputValue := strings.TrimSpace(view.InputValue)
		promptPrefix := " Input > "
		promptLine := styles.Success.Render(promptPrefix) + inputValue
		rows = append(rows, promptLine)
		promptRow := len(rows) - 1
		return footerLayout{
			Rows:      rows,
			InputRow:  promptRow,
			InputCol:  visibleLen(promptPrefix) + visibleLen(inputValue),
			HasPrompt: true,
		}
	}

	return footerLayout{
		Rows:      rows,
		InputRow:  -1,
		InputCol:  0,
		HasPrompt: false,
	}
}

func isInputReconnectNotice(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	return strings.Contains(normalized, "input stream was reconnected") || strings.Contains(normalized, "session restored")
}

func renderOptionCardLines(index int, option, detail string, width int, selected bool, recommended bool) []string {
	cardWidth := width - 2
	if cardWidth < 20 {
		cardWidth = 20
	}
	topLeft := "╭"
	topRight := "╮"
	bottomLeft := "╰"
	bottomRight := "╯"
	hLine := "─"
	accentPrefix := ""
	accentSuffix := ""
	if selected {
		topLeft = "╔"
		topRight = "╗"
		bottomLeft = "╚"
		bottomRight = "╝"
		hLine = "═"
		accentPrefix = ansiYellow
		accentSuffix = ansiReset
	}
	top := " " + accentPrefix + topLeft + strings.Repeat(hLine, cardWidth-2) + topRight + accentSuffix
	bottom := " " + accentPrefix + bottomLeft + strings.Repeat(hLine, cardWidth-2) + bottomRight + accentSuffix

	contentWidth := cardWidth - 4
	titlePrefix := fmt.Sprintf("%s[%d]%s ", ansiCyan, index, ansiReset)
	if selected {
		titlePrefix = styles.Warning.Render("▶") + " " + styles.Primary.Render(fmt.Sprintf("[%d]", index)) + " "
		if recommended {
			titlePrefix += styles.Success.Render("★ Recommended ")
		}
	} else if recommended {
		titlePrefix = styles.Primary.Render(fmt.Sprintf("[%d]", index)) + " " + styles.Success.Render("★ Recommended ")
	} else {
		titlePrefix = styles.Primary.Render(fmt.Sprintf("[%d]", index)) + " "
	}
	titlePrefixLen := visibleLen(titlePrefix)
	if titlePrefixLen > contentWidth {
		titlePrefix = fmt.Sprintf("[%d] ", index)
		titlePrefixLen = visibleLen(titlePrefix)
	}

	wrapWidth := contentWidth - titlePrefixLen
	if wrapWidth < 8 {
		wrapWidth = 8
	}

	wrapped := wrapText(option, wrapWidth)
	lines := make([]string, 0, 2+len(wrapped))
	lines = append(lines, top)
	for i, text := range wrapped {
		prefix := strings.Repeat(" ", titlePrefixLen)
		if i == 0 {
			prefix = titlePrefix
		}
		line := " " + "│ " + padVisual(prefix+text, contentWidth) + " │"
		lines = append(lines, line)
	}
	if strings.TrimSpace(detail) != "" {
		detailWidth := contentWidth - titlePrefixLen
		if detailWidth < 8 {
			detailWidth = 8
		}
		for _, text := range wrapText(detail, detailWidth) {
			if text == "" {
				continue
			}
			detailText := strings.Repeat(" ", titlePrefixLen) + styles.Detail.Render(text)
			line := " " + "│ " + padVisual(detailText, contentWidth) + " │"
			lines = append(lines, line)
		}
	}
	lines = append(lines, bottom)
	return lines
}

func buildLogoLines(width int, frame int) []string {
	_ = frame
	lines := owliabotASCIIBannerLines()
	brand := brandASCIIColor()
	if width < 64 {
		return []string{centerText(ansiBold+ansiRGB(brand)+"OwliaBot"+ansiReset, width)}
	}
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		out = append(out, centerText(ansiBold+ansiRGB(brand)+line+ansiReset, width))
	}
	return out
}

func brandASCIIColor() rgbColor {
	return rgbColor{R: 79, G: 70, B: 229} // #4f46e5
}

func optionZoneID(index int) string {
	return fmt.Sprintf("option-%d", index)
}

func journeyZoneID(index int) string {
	return fmt.Sprintf("journey-%d", index)
}

func markMultiline(id, content string) []string {
	if strings.TrimSpace(content) == "" {
		return []string{content}
	}
	return strings.Split(zone.Mark(id, content), "\n")
}

type rgbColor struct {
	R int
	G int
	B int
}

func rainbowPalette() []rgbColor {
	return []rgbColor{
		{R: 255, G: 112, B: 112},
		{R: 255, G: 170, B: 92},
		{R: 255, G: 226, B: 110},
		{R: 145, G: 235, B: 160},
		{R: 118, G: 214, B: 255},
		{R: 198, G: 154, B: 255},
	}
}

func owliabotASCIIBannerLines() []string {
	return buildSolidWordLines("OWLIABOT", 1)
}

func buildSolidWordLines(word string, scale int) []string {
	glyphs := pixelGlyphs()
	if scale < 1 {
		scale = 1
	}
	letterGap := 2
	if scale >= 2 {
		letterGap = 3
	}

	upper := strings.ToUpper(word)
	height := 0
	width := 0
	for _, r := range upper {
		g, ok := glyphs[r]
		if !ok {
			g = glyphs['?']
		}
		if len(g) > height {
			height = len(g)
		}
		width += len(g[0]) + letterGap
	}
	if width > 0 {
		width -= letterGap
	}
	if width <= 0 || height <= 0 {
		return []string{word}
	}

	bitmap := make([][]bool, height)
	for y := range bitmap {
		bitmap[y] = make([]bool, width)
	}

	xOffset := 0
	for _, r := range upper {
		g, ok := glyphs[r]
		if !ok {
			g = glyphs['?']
		}
		for y := 0; y < len(g); y++ {
			for x := 0; x < len(g[y]); x++ {
				if g[y][x] == '1' {
					bitmap[y][xOffset+x] = true
				}
			}
		}
		xOffset += len(g[0]) + letterGap
	}

	lines := make([]string, 0, height*scale)
	for y := 0; y < height; y++ {
		var b strings.Builder
		for x := 0; x < width; x++ {
			if bitmap[y][x] {
				b.WriteString(strings.Repeat("█", scale))
			} else {
				b.WriteString(strings.Repeat(" ", scale))
			}
		}
		row := strings.TrimRight(b.String(), " ")
		for sy := 0; sy < scale; sy++ {
			lines = append(lines, row)
		}
	}
	return lines
}

func neonPalette() []rgbColor {
	return []rgbColor{
		{R: 116, G: 230, B: 255},
		{R: 255, G: 125, B: 239},
		{R: 182, G: 149, B: 255},
		{R: 130, G: 255, B: 210},
	}
}

func buildNeonLogoWordLines(word string, scale int) []string {
	glyphs := pixelGlyphs()
	if scale < 1 {
		scale = 1
	}
	letterGap := 1
	if scale >= 2 {
		letterGap = 3
	} else {
		letterGap = 2
	}

	upper := strings.ToUpper(word)
	letters := make([][]string, 0, len(upper))
	height := 0
	width := 0
	for _, r := range upper {
		g, ok := glyphs[r]
		if !ok {
			g = glyphs['?']
		}
		letters = append(letters, g)
		if len(g) > height {
			height = len(g)
		}
		width += len(g[0]) + letterGap
	}
	if len(letters) == 0 || height == 0 {
		return []string{word}
	}
	width -= letterGap

	main := make([][]bool, height)
	colorIndex := make([][]int, height)
	for y := 0; y < height; y++ {
		main[y] = make([]bool, width)
		colorIndex[y] = make([]int, width)
		for x := 0; x < width; x++ {
			colorIndex[y][x] = -1
		}
	}

	palette := neonPalette()

	xOffset := 0
	for idx, g := range letters {
		pi := 0
		if len(palette) > 0 {
			pi = idx % len(palette)
		}
		for y := 0; y < len(g); y++ {
			for dx := 0; dx < len(g[y]); dx++ {
				if g[y][dx] == '1' {
					main[y][xOffset+dx] = true
					colorIndex[y][xOffset+dx] = pi
				}
			}
		}
		xOffset += len(g[0]) + letterGap
	}

	lines := make([]string, 0, height*scale)
	for y := 0; y < height; y++ {
		var b strings.Builder
		for x := 0; x < width; x++ {
			token := strings.Repeat(" ", scale)
			if main[y][x] && colorIndex[y][x] >= 0 {
				c := brightenColor(palette[colorIndex[y][x]], 1.02)
				token = ansiBold + ansiRGB(c) + strings.Repeat("█", scale) + ansiReset
			}
			b.WriteString(token)
		}
		row := strings.TrimRight(b.String(), " ")
		for sy := 0; sy < scale; sy++ {
			lines = append(lines, row)
		}
	}
	return lines
}

func brightenColor(c rgbColor, factor float64) rgbColor {
	if factor < 0 {
		factor = 0
	}
	return rgbColor{
		R: clampColorInt(int(math.Round(float64(c.R) * factor))),
		G: clampColorInt(int(math.Round(float64(c.G) * factor))),
		B: clampColorInt(int(math.Round(float64(c.B) * factor))),
	}
}

func clampColorInt(v int) int {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return v
}

func ansiRGB(c rgbColor) string {
	return fmt.Sprintf("\033[38;2;%d;%d;%dm", c.R, c.G, c.B)
}

func logoScale(width int) int {
	if width >= 150 {
		return 2
	}
	return 1
}

func buildPixelWordLines(word string, mainColor string, shadowColor string, scale int) []string {
	glyphs := pixelGlyphs()
	if scale < 1 {
		scale = 1
	}
	letterGap := 1
	if scale >= 2 {
		letterGap = 3
	}

	upper := strings.ToUpper(word)
	height := 0
	for _, r := range upper {
		g, ok := glyphs[r]
		if !ok {
			g = glyphs['?']
		}
		if len(g) > height {
			height = len(g)
		}
	}
	if height == 0 {
		return []string{word}
	}
	width := 0
	for _, r := range upper {
		g, ok := glyphs[r]
		if !ok {
			g = glyphs['?']
		}
		width += len(g[0]) + letterGap
	}
	if width > 0 {
		width -= letterGap
	}

	bitmap := make([][]bool, height)
	for i := range bitmap {
		bitmap[i] = make([]bool, width)
	}

	x := 0
	for _, r := range upper {
		g, ok := glyphs[r]
		if !ok {
			g = glyphs['?']
		}
		for y := 0; y < height; y++ {
			if y >= len(g) {
				continue
			}
			for dx := 0; dx < len(g[y]); dx++ {
				if g[y][dx] == '1' {
					bitmap[y][x+dx] = true
				}
			}
		}
		x += len(g[0]) + letterGap
	}

	outHeight := height + 1
	outWidth := width + 1
	lines := make([]string, 0, outHeight)
	for y := 0; y < outHeight; y++ {
		var b strings.Builder
		for x := 0; x < outWidth; x++ {
			mainOn := y < height && x < width && bitmap[y][x]
			shadowOn := shadowColor != "" && y > 0 && x > 0 && y-1 < height && x-1 < width && bitmap[y-1][x-1]

			token := strings.Repeat(" ", scale)
			if shadowOn {
				token = shadowColor + strings.Repeat("▓", scale) + ansiReset
			}
			if mainOn {
				token = mainColor + strings.Repeat("█", scale) + ansiReset
			}
			b.WriteString(token)
		}
		row := strings.TrimRight(b.String(), " ")
		for sy := 0; sy < scale; sy++ {
			lines = append(lines, row)
		}
	}
	return lines
}

func pixelGlyphs() map[rune][]string {
	return map[rune][]string{
		'O': {"01110", "10001", "10001", "10001", "10001", "10001", "01110"},
		'W': {"10001", "10001", "10001", "10101", "10101", "11011", "10001"},
		'L': {"10000", "10000", "10000", "10000", "10000", "10000", "11111"},
		'I': {"11111", "00100", "00100", "00100", "00100", "00100", "11111"},
		'A': {"01110", "10001", "10001", "11111", "10001", "10001", "10001"},
		'B': {"11110", "10001", "10001", "11110", "10001", "10001", "11110"},
		'T': {"11111", "00100", "00100", "00100", "00100", "00100", "00100"},
		'?': {"11111", "00001", "00110", "00000", "00100", "00000", "00100"},
	}
}

func centerText(text string, width int) string {
	visual := visibleLen(text)
	if visual >= width {
		return truncateVisual(text, width)
	}
	left := (width - visual) / 2
	return strings.Repeat(" ", left) + text
}

func stepMeta(index, total int, title string) string {
	if total <= 0 {
		total = 1
	}
	if index < 0 {
		index = 0
	}
	if title == "" {
		title = "Setup"
	}
	return fmt.Sprintf(" Step %d/%d  %s", index+1, total, title)
}

func boxTop(width int) string {
	return "┌" + strings.Repeat("─", width) + "┐"
}

func boxMid(width int) string {
	return "├" + strings.Repeat("─", width) + "┤"
}

func boxBottom(width int) string {
	return "└" + strings.Repeat("─", width) + "┘"
}

func boxSplit(left, right int) string {
	return "├" + strings.Repeat("─", left) + "┼" + strings.Repeat("─", right) + "┤"
}

func boxRow(width int, text string) string {
	return "│" + padVisual(text, width) + "│"
}

func boxSplitRow(left, right int, l, r string) string {
	return "│" + padVisual(l, left) + "│" + padVisual(r, right) + "│"
}

func padVisual(text string, width int) string {
	visible := visibleLen(text)
	if visible > width {
		return truncateVisual(text, width)
	}
	return text + strings.Repeat(" ", width-visible)
}

func truncateVisual(text string, width int) string {
	if width <= 0 {
		return ""
	}
	if visibleLen(text) <= width {
		return text
	}
	plain := stripANSI(text)
	runes := []rune(plain)
	if len(runes) <= width {
		return plain
	}
	if width <= 3 {
		return string(runes[:width])
	}
	return string(runes[:width-3]) + "..."
}

func wrapText(text string, width int) []string {
	plain := strings.TrimSpace(stripANSI(text))
	if plain == "" {
		return []string{""}
	}
	if width <= 0 {
		return []string{plain}
	}
	words := strings.Fields(plain)
	if len(words) == 0 {
		return []string{""}
	}
	lines := []string{}
	current := words[0]
	for _, word := range words[1:] {
		candidate := current + " " + word
		if utf8.RuneCountInString(candidate) <= width {
			current = candidate
			continue
		}
		if utf8.RuneCountInString(current) > width {
			lines = append(lines, breakWord(current, width)...)
		} else {
			lines = append(lines, current)
		}
		current = word
	}
	if utf8.RuneCountInString(current) > width {
		lines = append(lines, breakWord(current, width)...)
	} else {
		lines = append(lines, current)
	}
	return lines
}

func breakWord(word string, width int) []string {
	if width <= 0 {
		return []string{word}
	}
	runes := []rune(word)
	if len(runes) <= width {
		return []string{word}
	}
	out := make([]string, 0, len(runes)/width+1)
	for len(runes) > 0 {
		take := width
		if take > len(runes) {
			take = len(runes)
		}
		out = append(out, string(runes[:take]))
		runes = runes[take:]
	}
	return out
}

func visibleLen(s string) int {
	return utf8.RuneCountInString(stripANSI(s))
}

func stripANSI(s string) string {
	var b strings.Builder
	inEsc := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == 0x1b {
			inEsc = true
			continue
		}
		if inEsc {
			if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') {
				inEsc = false
			}
			continue
		}
		b.WriteByte(ch)
	}
	return b.String()
}

func terminalSize() (int, int) {
	if cols, rows, ok := getTerminalSizeFromIOCTL(int(os.Stdout.Fd())); ok {
		return cols, rows
	}
	cols, _ := strconv.Atoi(strings.TrimSpace(os.Getenv("COLUMNS")))
	rows, _ := strconv.Atoi(strings.TrimSpace(os.Getenv("LINES")))
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 40
	}
	return cols, rows
}

func moveCursor(row, col int) {
	if row < 1 {
		row = 1
	}
	if col < 1 {
		col = 1
	}
	fmt.Printf("\033[%d;%dH", row, col)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func clamp(minValue, value, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func tailLines(lines []string, n int) []string {
	if len(lines) <= n {
		return lines
	}
	return lines[len(lines)-n:]
}

func selectHighlights(highlights []string, max int) []string {
	if max <= 0 || len(highlights) == 0 {
		return nil
	}
	if len(highlights) <= max {
		return highlights
	}
	alertIndex := -1
	for i, line := range highlights {
		upper := strings.ToUpper(line)
		if strings.Contains(upper, "EXISTING CONFIGURATION DETECTED") || strings.Contains(upper, "DETECTED EXISTING CONFIGURATION") {
			alertIndex = i
			break
		}
	}
	if alertIndex >= 0 {
		if max == 1 {
			return []string{highlights[alertIndex]}
		}
		pinned := []string{highlights[alertIndex]}
		if max >= 2 && alertIndex+1 < len(highlights) {
			pinned = append(pinned, highlights[alertIndex+1])
		}
		remaining := max - len(pinned)
		if remaining > 0 {
			extras := make([]string, 0, len(highlights))
			for i, line := range highlights {
				if i == alertIndex || i == alertIndex+1 {
					continue
				}
				extras = append(extras, line)
			}
			if len(extras) > remaining {
				extras = extras[:remaining]
			}
			pinned = append(pinned, extras...)
		}
		return pinned
	}
	if len(highlights) > max {
		return highlights[:max]
	}
	return highlights
}
