package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	zone "github.com/lrstanley/bubblezone"
)

func (w *wizardSession) askOption(title, question string, options []string, defaultIndex int, highlights []string) (int, error) {
	return w.askOptionWithDetails(title, question, options, nil, defaultIndex, -1, highlights)
}

func (w *wizardSession) askOptionWithDetails(
	title, question string,
	options []string,
	optionDetails []string,
	defaultIndex int,
	recommendedIndex int,
	highlights []string,
) (int, error) {
	if len(options) == 0 {
		return 0, errors.New("options cannot be empty")
	}
	if defaultIndex < 0 || defaultIndex >= len(options) {
		defaultIndex = 0
	}
	if recommendedIndex < 0 || recommendedIndex >= len(options) {
		recommendedIndex = -1
	}
	defer func() {
		w.showHelp = false
	}()

	if canUseRawOptionInput(w.input) {
		if choice, err, ok := w.askOptionRaw(title, question, options, optionDetails, defaultIndex, recommendedIndex, highlights); ok {
			if err == nil || !isInputEOF(err) {
				return choice, err
			}
			w.errorText = "Session restored."
			return w.askOptionLineBuffered(title, question, options, optionDetails, defaultIndex, recommendedIndex, highlights)
		}
	}

	return w.askOptionLineBuffered(title, question, options, optionDetails, defaultIndex, recommendedIndex, highlights)
}

func (w *wizardSession) askMultiSelectWithDetails(
	title, question string,
	options []string,
	optionDetails []string,
	defaultSelected []int,
	highlights []string,
) ([]int, error) {
	if len(options) == 0 {
		return nil, nil
	}
	selected := make([]bool, len(options))
	for _, idx := range defaultSelected {
		if idx >= 0 && idx < len(selected) {
			selected[idx] = true
		}
	}

	cursor := 0
	for i, isSelected := range selected {
		if isSelected {
			cursor = i
			break
		}
	}

	for {
		renderedOptions := make([]string, 0, len(options)+1)
		renderedDetails := make([]string, 0, len(options)+1)
		for i, option := range options {
			marker := " "
			stateText := "Not selected."
			if selected[i] {
				marker = "x"
				stateText = "Selected."
			}
			renderedOptions = append(renderedOptions, fmt.Sprintf("[%s] %s", marker, option))
			detail := ""
			if i < len(optionDetails) {
				detail = strings.TrimSpace(optionDetails[i])
			}
			if detail == "" {
				renderedDetails = append(renderedDetails, stateText)
			} else {
				renderedDetails = append(renderedDetails, detail+" "+stateText)
			}
		}
		renderedOptions = append(renderedOptions, "Done")
		renderedDetails = append(renderedDetails, "Confirm current selection and continue.")

		choice, err := w.askOptionWithDetails(
			title,
			question,
			renderedOptions,
			renderedDetails,
			clamp(0, cursor, len(renderedOptions)-1),
			-1,
			highlights,
		)
		if err != nil {
			return nil, err
		}
		if choice == len(options) {
			result := make([]int, 0, len(options))
			for i, isSelected := range selected {
				if isSelected {
					result = append(result, i)
				}
			}
			return result, nil
		}
		selected[choice] = !selected[choice]
		cursor = choice
	}
}

func (w *wizardSession) askOptionLineBuffered(
	title, question string,
	options []string,
	optionDetails []string,
	defaultIndex int,
	recommendedIndex int,
	highlights []string,
) (int, error) {
	selected := defaultIndex
	for {
		w.renderOptionPrompt(title, question, options, optionDetails, optionInputHint(true), "", selected, recommendedIndex, highlights, "", false, true)
		raw, err := w.reader.ReadString('\n')
		if err != nil {
			if isInputEOF(err) && w.ownsInput {
				w.errorText = "Please choose an option."
				w.reader = bufio.NewReader(w.input)
				continue
			}
			if w.recoverInputOnEOF(err) {
				w.errorText = "Session restored."
				continue
			}
			return 0, err
		}
		raw = strings.TrimSpace(raw)
		if strings.EqualFold(raw, "esc") || strings.EqualFold(raw, "back") {
			return 0, errBackRequested
		}
		if next, moved := applyLineBufferedNavigationInput(raw, selected, len(options)); moved {
			selected = next
			w.errorText = ""
			continue
		}
		if raw == "?" {
			w.showHelp = !w.showHelp
			w.errorText = ""
			continue
		}
		if isArrowUpInput(raw) {
			if selected > 0 {
				selected--
			}
			w.errorText = ""
			continue
		}
		if isArrowDownInput(raw) {
			if selected < len(options)-1 {
				selected++
			}
			w.errorText = ""
			continue
		}
		if raw == "" {
			w.errorText = ""
			return selected, nil
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > len(options) {
			w.errorText = fmt.Sprintf("Please enter a number between 1 and %d.", len(options))
			continue
		}
		w.errorText = ""
		return n - 1, nil
	}
}

func (w *wizardSession) askOptionRaw(
	title, question string,
	options []string,
	optionDetails []string,
	defaultIndex int,
	recommendedIndex int,
	highlights []string,
) (int, error, bool) {
	restoreState, ok := enableRawInputMode(w.input)
	if !ok {
		return 0, nil, false
	}
	defer func() {
		if restoreState != nil {
			restoreState()
		}
	}()

	input := ""
	selected := defaultIndex
	escapeState := 0 // 0=none,1=ESC,2=ESC[,3=ESC[< mouse
	mouseSeq := ""

	for {
		w.renderOptionPrompt(title, question, options, optionDetails, optionInputHint(false), input, selected, recommendedIndex, highlights, "", true, false)

		b := make([]byte, 8)
		nRead, err := w.input.Read(b)
		if err != nil {
			if w.recoverInputOnEOF(err) {
				if restoreState != nil {
					restoreState()
				}
				nextRestore, nextOK := enableRawInputMode(w.input)
				if !nextOK {
					return 0, err, true
				}
				restoreState = nextRestore
				input = ""
				escapeState = 0
				mouseSeq = ""
				w.errorText = "Session restored."
				continue
			}
			return 0, err, true
		}
		if nRead == 0 {
			if escapeState == 1 {
				return 0, errBackRequested, true
			}
			if escapeState != 0 {
				escapeState = 0
				mouseSeq = ""
			}
			continue
		}

		for _, ch := range b[:nRead] {
			if escapeState == 1 {
				if isArrowEscapeLeader(ch) {
					escapeState = 2
					continue
				}
				escapeState = 0
				continue
			}
			if escapeState == 2 {
				switch ch {
				case '<':
					escapeState = 3
					mouseSeq = "<"
					continue
				case 'A':
					escapeState = 0
					if selected > 0 {
						selected--
					}
				case 'B':
					escapeState = 0
					if selected < len(options)-1 {
						selected++
					}
				default:
					escapeState = 0
				}
				input = ""
				w.errorText = ""
				continue
			}
			if escapeState == 3 {
				mouseSeq += string(ch)
				if ch != 'm' && ch != 'M' {
					continue
				}
				escapeState = 0
				msg, ok := parseMouseSGR(mouseSeq)
				mouseSeq = ""
				if !ok {
					continue
				}
				idx, hit := resolveMouseOptionClick(msg, len(options))
				if !hit {
					if w.canJourneyJump() {
						if target, jump := resolveMouseJourneyClick(msg, len(w.steps), w.stepIndex); jump {
							return 0, stepJumpRequestedError{step: target}, true
						}
					}
					continue
				}
				selected = idx
				w.errorText = ""
				input = ""
				return selected, nil, true
			}

			switch ch {
			case 3:
				return 0, errors.New("cancelled by user"), true
			case 27:
				escapeState = 1
			case 13, 10:
				if strings.TrimSpace(input) == "" {
					w.errorText = ""
					return selected, nil, true
				}
				n, err := strconv.Atoi(input)
				if err != nil || n < 1 || n > len(options) {
					w.errorText = fmt.Sprintf("Please enter a number between 1 and %d.", len(options))
					input = ""
					continue
				}
				w.errorText = ""
				return n - 1, nil, true
			case 127, 8:
				if len(input) > 0 {
					input = input[:len(input)-1]
				}
			case '?':
				w.showHelp = !w.showHelp
				w.errorText = ""
			default:
				if ch >= '0' && ch <= '9' {
					if len(input) < 3 {
						input += string(ch)
					}
				}
			}
		}

		if strings.TrimSpace(input) != "" {
			n, err := strconv.Atoi(input)
			if err == nil && n >= 1 && n <= len(options) {
				selected = n - 1
				w.errorText = ""
			}
		}
	}
}

func canUseRawOptionInput(input *os.File) bool {
	if input == nil {
		return false
	}
	fi, err := input.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

func enableRawInputMode(input *os.File) (func(), bool) {
	if input == nil {
		return nil, false
	}

	stateCmd := exec.Command("stty", "-g")
	stateCmd.Stdin = input
	rawState, err := stateCmd.Output()
	if err != nil {
		return nil, false
	}
	saved := strings.TrimSpace(string(rawState))
	if saved == "" {
		return nil, false
	}

	// Use cbreak-like mode instead of `raw` to keep output post-processing.
	// `stty raw` disables OPOST, which breaks newline rendering in our TUI.
	enableCmd := exec.Command("stty", rawInputSttyArgs()...)
	enableCmd.Stdin = input
	if err := enableCmd.Run(); err != nil {
		return nil, false
	}
	enableMouseTracking()

	restore := func() {
		disableMouseTracking()
		restoreCmd := exec.Command("stty", saved)
		restoreCmd.Stdin = input
		_ = restoreCmd.Run()
	}
	return restore, true
}

func rawInputSttyArgs() []string {
	return []string{"-icanon", "-echo", "min", "0", "time", "1"}
}

func enableMouseTracking() {
	fmt.Print("\033[?1000h\033[?1006h")
}

func disableMouseTracking() {
	fmt.Print("\033[?1000l\033[?1006l")
}

func parseMouseSGR(seq string) (zone.MouseMsg, bool) {
	// Sequence format after ESC[< ... is "<cb;cx;cym|M"
	if len(seq) < 5 || seq[0] != '<' {
		return zone.MouseMsg{}, false
	}
	actionCh := seq[len(seq)-1]
	if actionCh != 'm' && actionCh != 'M' {
		return zone.MouseMsg{}, false
	}

	parts := strings.Split(seq[1:len(seq)-1], ";")
	if len(parts) != 3 {
		return zone.MouseMsg{}, false
	}

	cb, err := strconv.Atoi(parts[0])
	if err != nil {
		return zone.MouseMsg{}, false
	}
	cx, err := strconv.Atoi(parts[1])
	if err != nil {
		return zone.MouseMsg{}, false
	}
	cy, err := strconv.Atoi(parts[2])
	if err != nil {
		return zone.MouseMsg{}, false
	}
	if cx <= 0 || cy <= 0 {
		return zone.MouseMsg{}, false
	}

	buttonCode := cb & 0b11
	button := zone.MouseButtonNone
	switch buttonCode {
	case 0:
		button = zone.MouseButtonLeft
	case 1:
		button = zone.MouseButtonMiddle
	case 2:
		button = zone.MouseButtonRight
	case 3:
		button = zone.MouseButtonNone
	}

	action := zone.MouseActionPress
	if actionCh == 'm' {
		action = zone.MouseActionRelease
	}
	if cb&32 != 0 {
		action = zone.MouseActionMotion
	}

	return zone.MouseMsg{
		X:      cx - 1,
		Y:      cy - 1,
		Button: button,
		Action: action,
		Alt:    cb&8 != 0,
		Ctrl:   cb&16 != 0,
		Shift:  cb&4 != 0,
	}, true
}

func resolveMouseOptionClick(msg zone.MouseMsg, optionsCount int) (int, bool) {
	if msg.Button != zone.MouseButtonLeft {
		return 0, false
	}
	if msg.Action != zone.MouseActionPress && msg.Action != zone.MouseActionRelease {
		return 0, false
	}

	for i := 0; i < optionsCount; i++ {
		z := zone.Get(optionZoneID(i))
		if z != nil && z.InBounds(msg) {
			return i, true
		}
	}
	return 0, false
}

func resolveMouseJourneyClick(msg zone.MouseMsg, stepsCount int, activeStep int) (int, bool) {
	if msg.Button != zone.MouseButtonLeft {
		return 0, false
	}
	if msg.Action != zone.MouseActionPress && msg.Action != zone.MouseActionRelease {
		return 0, false
	}
	if stepsCount <= 0 {
		return 0, false
	}
	if activeStep < 0 {
		activeStep = 0
	}
	if activeStep >= stepsCount {
		activeStep = stepsCount - 1
	}

	for i := 0; i <= activeStep; i++ {
		z := zone.Get(journeyZoneID(i))
		if z != nil && z.InBounds(msg) {
			return i, true
		}
	}
	return 0, false
}

func (w *wizardSession) askInput(title, question string, defaultValue string, highlights []string) (string, error) {
	// Text input is intentionally line-buffered for reliability across tmux/script/bun wrappers.
	// Raw mode can drop visual echo in some pseudo-tty setups, making users think input was ignored.
	return w.askInputLineBuffered(title, question, defaultValue, highlights)
}

func (w *wizardSession) askInputLineBuffered(title, question string, defaultValue string, highlights []string) (string, error) {
	setLineInputModeFn(w.input)
	for {
		q := question
		if strings.TrimSpace(defaultValue) != "" {
			q = fmt.Sprintf("%s (default: %s)", question, defaultValue)
		}
		w.render(title, q, nil, "Type text and press Enter (click Journey to jump back)", "", -1, highlights, "", false)
		raw, err := w.reader.ReadString('\n')
		if err != nil {
			if w.recoverInputOnEOF(err) {
				w.errorText = "Session restored."
				continue
			}
			return "", err
		}
		raw = strings.TrimSpace(raw)
		if raw == "" {
			w.errorText = ""
			return defaultValue, nil
		}
		w.errorText = ""
		return raw, nil
	}
}

func setLineInputMode(input *os.File) {
	if input == nil {
		return
	}
	cmd := exec.Command("stty", "icanon", "echo")
	cmd.Stdin = input
	_ = cmd.Run()
}

func (w *wizardSession) askInputRaw(title, question string, defaultValue string, highlights []string) (string, error, bool) {
	restoreState, ok := enableRawInputMode(w.input)
	if !ok {
		return "", nil, false
	}
	defer restoreState()

	input := ""
	escapeState := 0 // 0=none,1=ESC,2=ESC[,3=ESC[< mouse
	mouseSeq := ""

	for {
		q := question
		if strings.TrimSpace(defaultValue) != "" {
			q = fmt.Sprintf("%s (default: %s)", question, defaultValue)
		}
		w.render(title, q, nil, "Type text and press Enter (click Journey to jump back)", input, -1, highlights, "", false)

		b := make([]byte, 8)
		nRead, err := w.input.Read(b)
		if err != nil {
			return "", err, true
		}
		if nRead == 0 {
			if escapeState != 0 {
				escapeState = 0
				mouseSeq = ""
			}
			continue
		}

		for _, ch := range b[:nRead] {
			changed := false
			if escapeState == 1 {
				if ch == '[' {
					escapeState = 2
					continue
				}
				escapeState = 0
				continue
			}
			if escapeState == 2 {
				if ch == '<' {
					escapeState = 3
					mouseSeq = "<"
					continue
				}
				escapeState = 0
				continue
			}
			if escapeState == 3 {
				mouseSeq += string(ch)
				if ch != 'm' && ch != 'M' {
					continue
				}
				escapeState = 0
				msg, ok := parseMouseSGR(mouseSeq)
				mouseSeq = ""
				if !ok {
					continue
				}
				if w.canJourneyJump() {
					if target, jump := resolveMouseJourneyClick(msg, len(w.steps), w.stepIndex); jump {
						return "", stepJumpRequestedError{step: target}, true
					}
				}
				continue
			}

			switch ch {
			case 3:
				return "", errors.New("cancelled by user"), true
			case 27:
				escapeState = 1
			case 13, 10:
				if strings.TrimSpace(input) == "" {
					w.errorText = ""
					return defaultValue, nil, true
				}
				w.render(title, q, nil, "Type text and press Enter (click Journey to jump back)", input, -1, highlights, "", false)
				w.errorText = ""
				return strings.TrimSpace(input), nil, true
			case 127, 8:
				if len(input) > 0 {
					input = input[:len(input)-1]
					changed = true
				}
			default:
				if ch >= 32 && ch != 127 {
					input += string(ch)
					changed = true
				}
			}
			if changed {
				w.render(title, q, nil, "Type text and press Enter (click Journey to jump back)", input, -1, highlights, "", false)
			}
		}
	}
}

func (w *wizardSession) askYN(title, question string, defaultYes bool, highlights []string) (bool, error) {
	defaultIndex := 1
	if defaultYes {
		defaultIndex = 0
	}
	choice, err := w.askOption(title, question, []string{"Yes", "No"}, defaultIndex, highlights)
	if err != nil {
		return false, err
	}
	return choice == 0, nil
}

func optionInputHint(lineBuffered bool) string {
	if lineBuffered {
		return "Type up/down or number + Enter to confirm."
	}
	return "Use arrows to choose, Enter to confirm (number shortcuts work)."
}

func applyLineBufferedNavigationInput(raw string, selected int, optionsCount int) (int, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || optionsCount <= 0 {
		return selected, false
	}

	if strings.EqualFold(raw, "up") {
		if selected > 0 {
			selected--
		}
		return selected, true
	}
	if strings.EqualFold(raw, "down") {
		if selected < optionsCount-1 {
			selected++
		}
		return selected, true
	}

	return applyEmbeddedArrowMoves(raw, selected, optionsCount)
}

func isArrowUpInput(raw string) bool {
	raw = strings.TrimSpace(raw)
	return strings.EqualFold(raw, "up") || isSingleArrowInput(raw, true)
}

func isArrowDownInput(raw string) bool {
	raw = strings.TrimSpace(raw)
	return strings.EqualFold(raw, "down") || isSingleArrowInput(raw, false)
}

func isArrowEscapeLeader(ch byte) bool {
	return ch == '[' || ch == 'O'
}

func isArrowParamChar(ch byte) bool {
	return (ch >= '0' && ch <= '9') || ch == ';'
}

func moveSelection(selected int, optionsCount int, up bool) int {
	if up {
		if selected > 0 {
			return selected - 1
		}
		return selected
	}
	if selected < optionsCount-1 {
		return selected + 1
	}
	return selected
}

func parseAnsiArrowToken(raw string, start int) (next int, up bool, ok bool) {
	if start+2 >= len(raw) || raw[start] != 0x1b || !isArrowEscapeLeader(raw[start+1]) {
		return start, false, false
	}
	if raw[start+1] == 'O' {
		dir := raw[start+2]
		if dir == 'A' || dir == 'B' {
			return start + 3, dir == 'A', true
		}
		return start, false, false
	}
	i := start + 2
	for i < len(raw) && isArrowParamChar(raw[i]) {
		i++
	}
	if i < len(raw) && (raw[i] == 'A' || raw[i] == 'B') {
		return i + 1, raw[i] == 'A', true
	}
	return start, false, false
}

func parseCaretArrowToken(raw string, start int) (next int, up bool, ok bool) {
	if start+2 >= len(raw) || raw[start] != '^' || raw[start+1] != '[' || !isArrowEscapeLeader(raw[start+2]) {
		return start, false, false
	}
	if raw[start+2] == 'O' {
		if start+3 < len(raw) && (raw[start+3] == 'A' || raw[start+3] == 'B') {
			return start + 4, raw[start+3] == 'A', true
		}
		return start, false, false
	}
	i := start + 3
	for i < len(raw) && isArrowParamChar(raw[i]) {
		i++
	}
	if i < len(raw) && (raw[i] == 'A' || raw[i] == 'B') {
		return i + 1, raw[i] == 'A', true
	}
	return start, false, false
}

func isSingleArrowInput(raw string, up bool) bool {
	next, parsedUp, ok := parseAnsiArrowToken(raw, 0)
	if ok && next == len(raw) {
		return parsedUp == up
	}
	next, parsedUp, ok = parseCaretArrowToken(raw, 0)
	return ok && next == len(raw) && parsedUp == up
}

func applyEmbeddedArrowMoves(raw string, selected int, optionsCount int) (int, bool) {
	moved := false
	for i := 0; i < len(raw); {
		if next, up, ok := parseAnsiArrowToken(raw, i); ok {
			selected = moveSelection(selected, optionsCount, up)
			moved = true
			i = next
			continue
		}
		if next, up, ok := parseCaretArrowToken(raw, i); ok {
			selected = moveSelection(selected, optionsCount, up)
			moved = true
			i = next
			continue
		}
		i++
	}
	return selected, moved
}
