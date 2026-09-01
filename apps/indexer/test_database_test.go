package indexer

import (
	"fmt"
	"net/url"
	"strings"
)

func validateIntegrationDatabaseURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid integration database URL: %w", err)
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return fmt.Errorf("integration database URL must use postgres or postgresql scheme")
	}
	database := strings.Trim(u.Path, "/")
	if database == "" {
		return fmt.Errorf("integration database URL must name an explicit database in its path")
	}
	database, err = url.PathUnescape(database)
	if err != nil || strings.Contains(database, "/") {
		return fmt.Errorf("integration database URL has an invalid database path")
	}
	database = strings.ToLower(strings.TrimSpace(database))
	if database == "cooket" || !strings.HasSuffix(database, "_test") {
		return fmt.Errorf("integration database %q is not an explicitly safe *_test database", database)
	}
	return nil
}
