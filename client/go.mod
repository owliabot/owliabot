module github.com/owliabot/owliabot/client

go 1.21

require (
	github.com/charmbracelet/lipgloss v0.0.0
	github.com/lrstanley/bubblezone v0.0.0
)

replace github.com/lrstanley/bubblezone => ./third_party/bubblezone

replace github.com/charmbracelet/lipgloss => ./third_party/lipgloss
