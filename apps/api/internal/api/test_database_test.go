package api

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
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

func integrationDatabaseURL(t *testing.T, envName string) string {
	t.Helper()
	urlValue := os.Getenv(envName)
	if urlValue == "" {
		t.Skipf("set %s to run PostgreSQL API integration tests", envName)
	}
	if err := validateIntegrationDatabaseURL(urlValue); err != nil {
		t.Fatal(err)
	}
	return urlValue
}

func TestValidateIntegrationDatabaseURLUsesDatabasePathOnly(t *testing.T) {
	for _, tc := range []struct {
		name string
		url  string
		want bool
	}{
		{name: "development database", url: "postgresql://cooket:local@127.0.0.1:5432/cooket", want: false},
		{name: "application name cannot bypass", url: "postgresql://cooket:local@127.0.0.1:5432/cooket?application_name=api_test", want: false},
		{name: "query database name cannot bypass", url: "postgresql://cooket:local@127.0.0.1:5432/cooket?dbname=cooket_api_test", want: false},
		{name: "username cannot bypass", url: "postgresql://cooket_api_test:local@127.0.0.1:5432/cooket", want: false},
		{name: "explicit test database", url: "postgresql://cooket:local@127.0.0.1:5432/cooket_api_test?application_name=api", want: true},
		{name: "migration validation database", url: "postgresql://cooket:local@127.0.0.1:5432/partial_test", want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateIntegrationDatabaseURL(tc.url)
			if (err == nil) != tc.want {
				t.Fatalf("url=%q err=%v want_safe=%v", tc.url, err, tc.want)
			}
		})
	}
}
