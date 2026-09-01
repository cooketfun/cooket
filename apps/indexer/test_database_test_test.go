package indexer

import "testing"

func TestValidateIntegrationDatabaseURLUsesDatabasePathOnly(t *testing.T) {
	for _, tc := range []struct {
		name string
		url  string
		want bool
	}{
		{name: "development database", url: "postgresql://cooket:local@127.0.0.1:5432/cooket", want: false},
		{name: "application name cannot bypass", url: "postgresql://cooket:local@127.0.0.1:5432/cooket?application_name=indexer_test", want: false},
		{name: "query database name cannot bypass", url: "postgresql://cooket:local@127.0.0.1:5432/cooket?dbname=cooket_test", want: false},
		{name: "hostname cannot bypass", url: "postgresql://cooket_test:local@cooket_test/cooket", want: false},
		{name: "explicit test database", url: "postgresql://cooket:local@127.0.0.1:5432/cooket_indexer_test?application_name=worker", want: true},
		{name: "api convention", url: "postgresql://cooket:local@127.0.0.1:5432/cooket_api_test", want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateIntegrationDatabaseURL(tc.url)
			if (err == nil) != tc.want {
				t.Fatalf("url=%q err=%v want_safe=%v", tc.url, err, tc.want)
			}
		})
	}
}
