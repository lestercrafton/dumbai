// Signed vehicle commands (Tesla Vehicle Command Protocol) via github.com/teslamotors/vehicle-command.
// Internal only: the Node app authorizes the user and VIN, then calls this with an HMAC (CRON_SECRET) over the body.
package handler

import (
	"context"
	"crypto/ecdsa"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/teslamotors/vehicle-command/pkg/account"
	"github.com/teslamotors/vehicle-command/pkg/protocol"
	"github.com/teslamotors/vehicle-command/pkg/vehicle"
)

type req struct {
	Vin   string  `json:"vin"`
	Token string  `json:"token"`
	Cmd   string  `json:"cmd"`
	Arg   float64 `json:"arg"`
	Ts    int64   `json:"ts"`
}

func loadKey() (protocol.ECDHPrivateKey, error) {
	raw := strings.TrimSpace(os.Getenv("TESLA_PRIVATE_KEY"))
	if raw == "" {
		return nil, errors.New("TESLA_PRIVATE_KEY not set")
	}
	if !strings.Contains(raw, "BEGIN") {
		b, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, errors.New("TESLA_PRIVATE_KEY is not PEM or base64 PEM")
		}
		raw = string(b)
	}
	raw = strings.ReplaceAll(raw, `\n`, "\n")
	blk, _ := pem.Decode([]byte(raw))
	if blk == nil {
		return nil, errors.New("TESLA_PRIVATE_KEY: no PEM block")
	}
	k, err := x509.ParseECPrivateKey(blk.Bytes)
	if err != nil {
		pk, err2 := x509.ParsePKCS8PrivateKey(blk.Bytes)
		if err2 != nil {
			return nil, fmt.Errorf("TESLA_PRIVATE_KEY: %v", err)
		}
		var ok bool
		if k, ok = pk.(*ecdsa.PrivateKey); !ok {
			return nil, errors.New("TESLA_PRIVATE_KEY: not an EC key")
		}
	}
	d := make([]byte, 32)
	kb := k.D.Bytes()
	copy(d[32-len(kb):], kb)
	return protocol.UnmarshalECDHPrivateKey(d), nil
}

func run(ctx context.Context, car *vehicle.Vehicle, cmd string, arg float64) error {
	switch cmd {
	case "wake":
		return nil
	case "windows-vent":
		return car.VentWindows(ctx)
	case "windows-close":
		return car.CloseWindows(ctx)
	case "climate-on":
		return car.ClimateOn(ctx)
	case "climate-off":
		return car.ClimateOff(ctx)
	case "set-temp":
		c := float32((arg - 32) * 5 / 9)
		return car.ChangeClimateTemp(ctx, c, c)
	case "charge-start":
		return car.ChargeStart(ctx)
	case "charge-stop":
		return car.ChargeStop(ctx)
	case "charge-limit":
		return car.ChangeChargeLimit(ctx, int32(arg))
	case "charge-amps":
		return car.SetChargingAmps(ctx, int32(arg))
	case "lock":
		return car.Lock(ctx)
	case "unlock":
		return car.Unlock(ctx)
	case "honk":
		return car.HonkHorn(ctx)
	case "flash":
		return car.FlashLights(ctx)
	}
	return fmt.Errorf("unknown command %q", cmd)
}

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	out := func(code int, v map[string]any) { w.WriteHeader(code); json.NewEncoder(w).Encode(v) }
	secret := os.Getenv("CRON_SECRET")
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	got, _ := hex.DecodeString(r.Header.Get("X-Sig"))
	if r.Method != http.MethodPost || secret == "" || !hmac.Equal(got, mac.Sum(nil)) {
		out(401, map[string]any{"error": "unauthorized"})
		return
	}
	var q req
	if err := json.Unmarshal(body, &q); err != nil || len(q.Vin) != 17 || q.Token == "" {
		out(400, map[string]any{"error": "bad request"})
		return
	}
	if d := time.Now().UnixMilli() - q.Ts; d > 120000 || d < -120000 {
		out(401, map[string]any{"error": "stale request"})
		return
	}
	if q.Cmd == "dry-run" { // checks key + plumbing, never contacts the car
		_, err := loadKey()
		if err != nil {
			out(500, map[string]any{"error": err.Error()})
			return
		}
		out(200, map[string]any{"ok": true, "dryRun": true})
		return
	}
	key, err := loadKey()
	if err != nil {
		out(500, map[string]any{"error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	acct, err := account.New(q.Token, "ovanova-mileage/1.0")
	if err != nil {
		out(400, map[string]any{"error": "token: " + err.Error()})
		return
	}
	car, err := acct.GetVehicle(ctx, q.Vin, key, nil)
	if err != nil {
		out(502, map[string]any{"error": err.Error()})
		return
	}
	if err = car.Connect(ctx); err != nil {
		out(502, map[string]any{"error": "connect: " + err.Error()})
		return
	}
	defer car.Disconnect()
	if err = car.StartSession(ctx, nil); err != nil {
		msg := err.Error()
		if strings.Contains(strings.ToLower(msg), "key") || strings.Contains(msg, "public") {
			msg += " (is the app's key paired? open https://tesla.com/_ak/ovanova-mileage-tesla.vercel.app on your phone)"
		}
		out(502, map[string]any{"error": "session: " + msg})
		return
	}
	if err = run(ctx, car, q.Cmd, q.Arg); err != nil {
		out(502, map[string]any{"error": err.Error()})
		return
	}
	out(200, map[string]any{"ok": true})
}
