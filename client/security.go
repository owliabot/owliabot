package main

import "strings"

func DeriveWriteToolAllowList(discordMembers []string, telegramUsers []string, additional []string) []string {
	out := make([]string, 0, len(discordMembers)+len(telegramUsers)+len(additional))
	seen := map[string]struct{}{}
	for _, group := range [][]string{discordMembers, telegramUsers, additional} {
		for _, raw := range group {
			id := strings.TrimSpace(raw)
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out
}
