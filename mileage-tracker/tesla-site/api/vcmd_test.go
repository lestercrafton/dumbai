package handler

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func do(t *testing.T, body, sig string) (int, string) {
	r := httptest.NewRequest("POST", "/api/vcmd", strings.NewReader(body))
	r.Header.Set("X-Sig", sig)
	w := httptest.NewRecorder()
	Handler(w, r)
	return w.Code, w.Body.String()
}
func sg(b string) string { m := hmac.New(sha256.New, []byte("cs")); m.Write([]byte(b)); return hex.EncodeToString(m.Sum(nil)) }

func TestAuthAndDryRun(t *testing.T) {
	t.Setenv("CRON_SECRET", "cs")
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalECPrivateKey(k)
	t.Setenv("TESLA_PRIVATE_KEY", string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der})))
	b := fmt.Sprintf(`{"vin":"7SAYGDEE4RA246655","token":"x","cmd":"dry-run","ts":%d}`, time.Now().UnixMilli())
	if c, _ := do(t, b, "00"); c != 401 { t.Fatal("bad sig accepted", c) }
	if c, _ := do(t, b, sg(b+" ")); c != 401 { t.Fatal("wrong body sig accepted", c) }
	old := `{"vin":"7SAYGDEE4RA246655","token":"x","cmd":"dry-run","ts":1}`
	if c, _ := do(t, old, sg(old)); c != 401 { t.Fatal("stale accepted", c) }
	if c, s := do(t, b, sg(b)); c != 200 || !strings.Contains(s, "dryRun") { t.Fatal(c, s) }
	if _, err := loadKey(); err != nil { t.Fatal(err) }
}
