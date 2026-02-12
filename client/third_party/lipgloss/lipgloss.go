package lipgloss

import (
	"strconv"
	"strings"
)

type Color string

type Style struct {
	fg   string
	bg   string
	bold bool
}

func NewStyle() Style {
	return Style{}
}

func (s Style) Foreground(color Color) Style {
	s.fg = string(color)
	return s
}

func (s Style) Bold(enabled bool) Style {
	s.bold = enabled
	return s
}

func (s Style) Background(color Color) Style {
	s.bg = string(color)
	return s
}

func (s Style) Render(values ...string) string {
	text := strings.Join(values, "")
	if text == "" {
		return ""
	}

	prefix := ""
	if s.bold {
		prefix += "\033[1m"
	}
	if s.fg != "" {
		if n, err := strconv.Atoi(s.fg); err == nil {
			prefix += "\033[38;5;" + strconv.Itoa(n) + "m"
		}
	}
	if s.bg != "" {
		if n, err := strconv.Atoi(s.bg); err == nil {
			prefix += "\033[48;5;" + strconv.Itoa(n) + "m"
		}
	}
	if prefix == "" {
		return text
	}
	return prefix + text + "\033[0m"
}
