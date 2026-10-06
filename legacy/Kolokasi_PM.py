# ============================================================
# Dashboard Collocation - Streamlit + Plotly
# ------------------------------------------------------------
# Cara jalanin:
#   1) pip install -r requirements.txt
#   2) streamlit run dashboard_collocation.py
#
# Dashboard ini narik data dari endpoint Flask:
#   GET {URL_API}/api/get/get_collocation_dashboard?device=...
# jadi pastiin endpoint-nya udah jalan duluan yak.
#
# UPDATE terbaru:
#   - Data PurpleAir (tabel lcs_pa) ditampilin BARENGAN sama data BL
#     di grafik yang sama. Penamaan: "BL" = punya kita, "PA" = PurpleAir.
#     Garis BL solid, garis PA putus-putus (channel A) & titik-titik (channel B).
#   - Rata-rata per jam jadi 48 jam terakhir.
#   - Rata-rata harian jadi 14 hari terakhir (bukan cuma kemarin doang).
#   - Semua grafik DIKUNCI: gak bisa zoom, pan, atau kegeser. Jadi pas
#     scroll halaman terus kursor/jari kena grafik, halamannya tetep
#     jalan normal. Hover buat baca angka tetep nyala.
#   - Uji keseragaman SD & CV buat sensor BL. KHUSUS parameter PM2.5 dan
#     KHUSUS basis rata-rata harian. Sensor yang diikutkan bisa dipilih
#     sendiri (minimal 2), nilai M di rumus ngikut jumlah yang dipilih.
#     Sensor PurpleAir belum diikutkan.
#
# WAJIB pakai endpoint Flask versi baru, soalnya struktur 'rata2_harian'
# udah berubah dari nilai tunggal jadi list 14 hari.
#
# URL API default & daftar device tinggal diubah di bagian
# KONFIGURASI di bawah (atau langsung dari sidebar pas jalan).
# ============================================================

import math

import requests
import pandas as pd
import streamlit as st
import plotly.graph_objects as go
from streamlit_autorefresh import st_autorefresh

# ----------------------- KONFIGURASI -----------------------
API_BASE_DEFAULT = "https://rndbirulangit.pythonanywhere.com"

DEVICE_LIST = [
    "LCS_PM-Kolokasi DLH Sby 1",
    "Personal_Exposure_AQMS",
]

# Kalau mau kunci sensor PurpleAir tertentu, isi sensor_index-nya di sini.
# Dikosongin ([]) = ambil semua sensor PA yang ada datanya.
PA_SENSOR_FILTER = []

# Warna sensor BL dibikin KONSISTEN di semua grafik biar gampang dibandingin
SENSOR_COLORS = {1: "#2E86DE", 2: "#E67E22", 3: "#27AE60"}

# Warna PurpleAir - nada ungu/teal biar kebedain jelas dari sensor BL
PA_COLORS = ["#8E44AD", "#16A085", "#D81B60", "#5D4037", "#00838F",
             "#6A1B9A", "#00695C", "#AD1457", "#4E342E", "#01579B"]

TEMP_COLOR  = "#E74C3C"   # merah -> suhu
HUMID_COLOR = "#3498DB"   # biru  -> kelembapan

# ---- Uji keseragaman: syarat keberterimaan & sensor yang bisa dipilih ----
SYARAT_SD      = 5.0    # SD <= 5 µg/m³
SYARAT_CV      = 30.0   # CV <= 30 %
MIN_SENSOR_UJI = 2      # minimal sensor yang harus dipilih
SENSOR_BL      = {1: "PM25v_1", 2: "PM25v_2", 3: "PM25v_3"}   # cuma PM2.5

# ---- Setelan interaksi grafik (dipake di semua st.plotly_chart) ----
# Grafik dibikin FIXED: gak bisa di-zoom, di-geser, atau ke-reset gak sengaja.
CHART_CONFIG = {
    "displayModeBar": False,   # sembunyiin toolbar plotly (zoom, pan, kamera, dll)
    "scrollZoom": False,       # scroll di atas grafik = scroll halaman, bukan zoom
    "doubleClick": False,      # dobel klik gak nge-reset/autoscale
    "showAxisDragHandles": False,
    "displaylogo": False,
    "staticPlot": False,       # ganti True kalau mau MATI TOTAL (hover ikut ilang)
}

# Kalau tombol download PNG-nya masih kepake, ganti CHART_CONFIG di atas jadi:
#   "displayModeBar": True,
#   "modeBarButtonsToRemove": ["zoom2d", "pan2d", "select2d", "lasso2d",
#                              "zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d"],
# Sisanya biarin sama - nanti yang nongol cuma ikon kamera doang.

st.set_page_config(
    page_title="Dashboard Collocation",
    page_icon="🌫️",
    layout="wide",
    initial_sidebar_state="collapsed"
)


# ----------------------- HELPER -----------------------
def fmt(value, satuan="", desimal=2):
    """Format angka buat metric; kalau None tampilkan strip."""
    if value is None:
        return "—"
    return f"{value:.{desimal}f}{satuan}"


def fmt_sel(value, desimal=2):
    """Format isi sel tabel; NaN/None sama-sama jadi strip."""
    return fmt(value, desimal=desimal) if pd.notna(value) else "—"


def last_valid(values):
    """Ambil nilai non-null paling akhir dari sebuah list."""
    for v in reversed(values or []):
        if v is not None:
            return v
    return None


def kolom(values, n):
    """Paksa panjang list jadi pas n baris; kurang -> ditambal None, lebih -> dipotong.
    Biar DataFrame gak error kalau API & dashboard beda versi sedikit."""
    values = list(values or [])
    if len(values) < n:
        values += [None] * (n - len(values))
    return values[:n]


def rata2(values):
    """Rata-rata dari nilai yang non-null; kalau kosong semua -> None."""
    v = [x for x in values if x is not None]
    return sum(v) / len(v) if v else None


def kunci_grafik(fig):
    """Kunci grafik biar gak bisa di-zoom/geser.

    `fixedrange=True` yang bikin drag/sentuhan di atas grafik diterusin ke
    halaman (jadi scroll-nya normal), sedangkan CHART_CONFIG ngurusin
    toolbar & dobel klik.

    PENTING: panggil ini PALING AKHIR di tiap fungsi grafik, sesudah semua
    update_layout. Kalau dipanggil duluan, sumbu kanan (yaxis2) di grafik
    suhu/kelembapan gak ikut kekunci.
    """
    fig.update_xaxes(fixedrange=True)
    fig.update_yaxes(fixedrange=True)   # kena ke yaxis dan yaxis2 sekaligus
    fig.update_layout(dragmode=False)
    return fig


def hitung_sd_cv(df, kolom_sensor):
    """Uji keseragaman antar alat ukur identik.

        SD = sqrt( 1 / ((N x M) - 1) * SUM_j [ SUM_t (x_ktj - X_kt)^2 ] )
        CV = SD / X_kt * 100

    Keterangan:
      M     = jumlah alat ukur identik = panjang `kolom_sensor`, jadi ngikut
              sensor mana aja yang dipilih user
      N     = jumlah interval waktu saat SEMUA alat yang dipilih punya nilai
              valid. Interval yang salah satunya NULL dibuang utuh - bukan
              cuma sensor yang kosong doang.
      x_ktj = nilai alat ke-j pada interval t
      X_kt  = rata-rata seluruh alat pada interval t
      Buat CV dipakai rata-rata seluruh interval yang dihitung. Nilainya sama
      persis dengan rata-rata dari X_kt, soalnya tiap interval yang lolos pasti
      lengkap M alat.

    Pembagi (N x M) - 1 ditulis persis kayak di regulasi (bukan N x (M-1)).

    Fungsi ini dipake dua-duanya:
      - per hari         -> df berisi 1 baris, jadi N = 1
      - seluruh periode  -> df berisi semua hari, jadi N = jumlah hari valid
    """
    sub = df[kolom_sensor].apply(pd.to_numeric, errors="coerce").dropna()
    N, M = len(sub), len(kolom_sensor)

    if N * M < 2:
        return {"N": N, "M": M, "mean": None, "sd": None, "cv": None, "mean_alat": []}

    mean_t = sub.mean(axis=1)                                       # X_kt tiap interval
    jumlah_kuadrat = float(((sub.sub(mean_t, axis=0)) ** 2).to_numpy().sum())
    sd = math.sqrt(jumlah_kuadrat / (N * M - 1))

    mean_total = float(sub.to_numpy().mean())
    cv = (sd / mean_total * 100) if mean_total > 0 else None

    return {
        "N": N, "M": M, "mean": mean_total, "sd": sd, "cv": cv,
        "mean_alat": [float(sub[c].mean()) for c in kolom_sensor],
    }


def status_uji(hasil):
    """Putusan comply / not comply. Dua syarat harus lolos dua-duanya."""
    if hasil["sd"] is None:
        return "⚠️ Data belum lengkap"
    if hasil["sd"] <= SYARAT_SD and hasil["cv"] is not None and hasil["cv"] <= SYARAT_CV:
        return "✅ Comply"
    return "❌ Not Comply"


def nilai_syarat(nilai, batas, satuan="", desimal=2):
    """Tampilin angka + centang/silang sesuai syarat keberterimaan."""
    if nilai is None:
        return "—"
    return f"{nilai:.{desimal}f}{satuan} {'✅' if nilai <= batas else '❌'}"


@st.cache_data(ttl=60, show_spinner="Lagi narik data dari API...")
def fetch_dashboard(base_url, device, pa_sensor=""):
    params = {"device": device}
    if pa_sensor:
        params["pa_sensor"] = pa_sensor
    r = requests.get(
        f"{base_url.rstrip('/')}/api/get/get_collocation_dashboard",
        params=params,
        timeout=90,
    )
    r.raise_for_status()
    return r.json()


# ----------------------- GRAFIK -----------------------
def chart_pm25(df_bl, df_pa, pa_meta, x="timestamp", tickformat="%H:%M"):
    """PM2.5 gabungan: 3 sensor BL (garis solid) + channel A/B tiap sensor PA.
    df_bl & df_pa boleh DataFrame yang sama (buat seri per jam / harian),
    atau beda (buat seri mentah, karena BL per 2 menit & PA per 10 menit).
    Nilai NULL otomatis jadi celah di garis."""
    fig = go.Figure()

    for s in (1, 2, 3):
        col = f"PM25v_{s}"
        if col not in df_bl.columns:
            continue
        fig.add_trace(go.Scatter(
            x=df_bl[x],
            y=df_bl[col],
            mode="lines+markers",
            name=f"BL · Sensor {s}",
            line=dict(color=SENSOR_COLORS[s], width=2),
            marker=dict(size=6),
            connectgaps=False,
            hovertemplate="%{y:.2f} µg/m³<extra>BL Sensor " + str(s) + "</extra>",
        ))

    for m in pa_meta:
        for ch, col, garis, simbol in (
            ("A", m["col_a"], "dash", "diamond"),
            ("B", m["col_b"], "dot",  "square"),
        ):
            if col not in df_pa.columns:
                continue
            fig.add_trace(go.Scatter(
                x=df_pa[x],
                y=df_pa[col],
                mode="lines+markers",
                name=f"{m['label']} · Sensor {ch}",
                line=dict(color=m["color"], width=2, dash=garis),
                marker=dict(size=7, symbol=simbol),
                connectgaps=False,
                hovertemplate="%{y:.2f} µg/m³<extra>" + f"{m['label']} Ch {ch}" + "</extra>",
            ))

    fig.update_layout(
        hovermode="x unified",
        height=420,
        margin=dict(l=10, r=10, t=10, b=10),
        yaxis_title="µg/m³",
        xaxis=dict(tickformat=tickformat),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0),
    )
    fig.update_xaxes(showgrid=True, gridwidth=1, gridcolor='rgba(128, 128, 128, 0.2)')
    fig.update_yaxes(showgrid=True, gridwidth=1, gridcolor='rgba(128, 128, 128, 0.2)')
    return kunci_grafik(fig)


def chart_th(df, x="timestamp", tickformat="%H:%M"):
    """Suhu (sumbu kiri, °C) + kelembapan (sumbu kanan, %) dalam 1 grafik dual-axis."""
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df[x], y=df["Tempoutv"],
        mode="lines+markers", name="Suhu",
        line=dict(color=TEMP_COLOR, width=2), marker=dict(size=6),
        connectgaps=False, hovertemplate="%{y:.1f} °C<extra>Suhu</extra>",
    ))
    fig.add_trace(go.Scatter(
        x=df[x], y=df["Humidoutv"],
        mode="lines+markers", name="Kelembapan", yaxis="y2",
        line=dict(color=HUMID_COLOR, width=2), marker=dict(size=6),
        connectgaps=False, hovertemplate="%{y:.1f} %<extra>Kelembapan</extra>",
    ))
    fig.update_layout(
        hovermode="x unified",
        height=380,
        margin=dict(l=10, r=10, t=10, b=10),
        xaxis=dict(tickformat=tickformat),
        yaxis=dict(title="°C", showgrid=True, gridwidth=1, gridcolor='rgba(128, 128, 128, 0.2)'),
        # Sumbu kanan tanpa grid biar gak numpuk sama grid sumbu kiri
        yaxis2=dict(title="%", overlaying="y", side="right", showgrid=False),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0),
    )
    fig.update_xaxes(showgrid=True, gridwidth=1, gridcolor='rgba(128, 128, 128, 0.2)')
    return kunci_grafik(fig)


def chart_vbat(df):
    """Line chart tegangan baterai per 2 menit."""
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df["timestamp"], y=df["V_bat"],
        mode="lines+markers", name="V_bat",
        line=dict(color="#8E44AD", width=2), marker=dict(size=6),
        connectgaps=False, hovertemplate="%{y:.3f} V<extra></extra>",
    ))
    fig.update_layout(
        hovermode="x unified",
        height=380,
        margin=dict(l=10, r=10, t=10, b=10),
        yaxis_title="Volt",
        xaxis=dict(tickformat="%H:%M"),
        showlegend=False,
    )
    fig.update_xaxes(showgrid=True, gridwidth=1, gridcolor='rgba(128, 128, 128, 0.2)')
    fig.update_yaxes(showgrid=True, gridwidth=1, gridcolor='rgba(128, 128, 128, 0.2)')
    return kunci_grafik(fig)


# ----------------------- SIDEBAR -----------------------
with st.sidebar:
    st.header("⚙️ Pengaturan")

    device = st.selectbox("Device (BL)", DEVICE_LIST)

    pa_filter = st.text_input(
        "Sensor PurpleAir (opsional)",
        value=", ".join(str(x) for x in PA_SENSOR_FILTER),
        placeholder="contoh: 12345, 67890",
        help="Isi sensor_index-nya kalau mau nampilin sensor PA tertentu aja. Kosongin = semua sensor.",
    )

    st.divider()
    auto = st.toggle("🔁 Auto refresh", value=True)
    interval_menit = st.slider("Interval refresh (menit)", 1, 10, 2, disabled=not auto)

    if st.button("🔄 Refresh sekarang", use_container_width=True):
        fetch_dashboard.clear()

    st.caption("Data di-cache 1 menit biar API-nya gak digempur terus.")

if auto:
    st_autorefresh(interval=interval_menit * 60 * 1000, key="auto_refresh")


# ----------------------- AMBIL DATA -----------------------
try:
    data = fetch_dashboard(API_BASE_DEFAULT, device, pa_filter.strip())
except requests.exceptions.RequestException as e:
    st.error(
        "Gagal narik data dari API 😵\n\n"
        f"`{e}`\n\n"
        "Cek lagi URL API di sidebar, terus pastiin Flask-nya lagi jalan yak."
    )
    st.stop()

d2m  = data["per_2_menit"]
dhr  = data["rata2_per_jam"]
dday = data["rata2_harian"]
dbat = data["baterai"]
dupt = data.get("uptime") or {}
dpa  = data.get("purpleair") or {}

th2m = d2m.get("th") or {}
thhr = dhr.get("th") or {}
thdy = dday.get("th") or {}

n2m  = len(d2m["timestamps"])
nhr  = len(dhr["timestamps"])
nday = len(dday["tanggal"])

# ---- Siapin identitas tiap sensor PA: label, warna, nama kolom di DataFrame ----
pa_sensors = dpa.get("sensors") or []
pa_meta = []
for i, s in enumerate(pa_sensors):
    idx  = s.get("sensor_index")
    nama = (s.get("device") or "").strip()
    if len(pa_sensors) == 1:
        label = "PA"                     # cuma 1 sensor -> gak usah ribet
    elif nama:
        # jangan sampe jadi "PA PA Sby 1" kalau nama device-nya udah diawali PA
        label = nama if nama.upper().startswith("PA") else f"PA {nama}"
    else:
        label = f"PA {idx}"
    pa_meta.append({
        "sensor": s,
        "label": label,
        "color": PA_COLORS[i % len(PA_COLORS)],
        "col_a": f"PA{idx}_1",
        "col_b": f"PA{idx}_2",
    })

# ---- DataFrame BL per 2 menit ----
df_2m = pd.DataFrame({
    "timestamp": pd.to_datetime(d2m["timestamps"]),
    **{c: kolom(v, n2m) for c, v in d2m["pm"].items()},
    "Tempoutv":  kolom(th2m.get("Tempoutv"),  n2m),
    "Humidoutv": kolom(th2m.get("Humidoutv"), n2m),
    "V_bat": kolom(d2m["V_bat"], n2m),
})

# ---- DataFrame PA per 10 menit (timestamp-nya beda sama BL) ----
pa_ts  = dpa.get("timestamps_10_menit") or []
npa    = len(pa_ts)
df_pa  = pd.DataFrame({"timestamp": pd.to_datetime(pa_ts)})
for m in pa_meta:
    r = m["sensor"].get("per_10_menit") or {}
    df_pa[m["col_a"]] = kolom(r.get("PM25v_1"), npa)
    df_pa[m["col_b"]] = kolom(r.get("PM25v_2"), npa)

# ---- DataFrame rata2 per jam (BL + PA jadi satu, grid waktunya sama) ----
df_hr = pd.DataFrame({
    "timestamp": pd.to_datetime(dhr["timestamps"]),
    **{c: kolom(v, nhr) for c, v in dhr["pm"].items()},
    "Tempoutv":  kolom(thhr.get("Tempoutv"),  nhr),
    "Humidoutv": kolom(thhr.get("Humidoutv"), nhr),
})
for m in pa_meta:
    r = m["sensor"].get("rata2_per_jam") or {}
    df_hr[m["col_a"]] = kolom(r.get("PM25v_1"), nhr)
    df_hr[m["col_b"]] = kolom(r.get("PM25v_2"), nhr)

# ---- DataFrame rata2 harian (BL + PA) ----
df_day = pd.DataFrame({
    "tanggal": pd.to_datetime(dday["tanggal"]),
    **{c: kolom(v, nday) for c, v in dday["pm"].items()},
    "Tempoutv":  kolom(thdy.get("Tempoutv"),  nday),
    "Humidoutv": kolom(thdy.get("Humidoutv"), nday),
})
for m in pa_meta:
    r = m["sensor"].get("rata2_harian") or {}
    df_day[m["col_a"]] = kolom(r.get("PM25v_1"), nday)
    df_day[m["col_b"]] = kolom(r.get("PM25v_2"), nday)


# ----------------------- HEADER + METRICS -----------------------
st.title("🌫️ Dashboard Collocation")
st.caption(
    f"Device BL: **{data['device']}** · "
    f"Sensor PA: **{dpa.get('jumlah_sensor', 0)}** · "
    f"Data di-generate API: {data['generated_at']} WIB"
)

if dpa.get("error"):
    st.warning(f"Data PurpleAir gagal diambil: `{dpa['error']}`", icon="⚠️")
elif not pa_sensors:
    st.info(
        "Belum ada data PurpleAir di rentang waktu ini. "
        "Cek lagi isi tabel `lcs_pa` atau filter sensor di sidebar.",
        icon="ℹ️",
    )

# PM2.5 terkini = rata-rata nilai non-null terakhir dari tiap sensor/channel
pm25_bl_now = rata2([last_valid(d2m["pm"].get(f"PM25v_{s}")) for s in (1, 2, 3)])
pa_last = []
for m in pa_meta:
    r = m["sensor"].get("per_10_menit") or {}
    pa_last += [last_valid(r.get("PM25v_1")), last_valid(r.get("PM25v_2"))]
pm25_pa_now = rata2(pa_last)

temp_now  = last_valid(th2m.get("Tempoutv"))
humid_now = last_valid(th2m.get("Humidoutv"))

# Selisih PA vs BL (buat ngintip bias antar-alat sekilas)
selisih = (pm25_pa_now - pm25_bl_now) if (pm25_pa_now is not None and pm25_bl_now is not None) else None

r1c1, r1c2, r1c3, r1c4 = st.columns(4)
r1c1.metric(
    "🌫️ PM2.5 BL Terkini", fmt(pm25_bl_now, " µg/m³"),
    help="Rata-rata nilai terakhir dari 3 sensor BL",
)
r1c2.metric(
    "🟣 PM2.5 PA Terkini", fmt(pm25_pa_now, " µg/m³"),
    delta=f"{selisih:+.2f} vs BL" if selisih is not None else None,
    delta_color="off",
    help="Rata-rata nilai terakhir dari channel A & B semua sensor PurpleAir",
)
r1c3.metric("🌡️ Suhu Terkini", fmt(temp_now, " °C", 1))
r1c4.metric("💧 Kelembapan Terkini", fmt(humid_now, " %", 1))

# Tegangan terakhir + delta dibanding data sebelumnya
vbat_pts = [v for v in d2m["V_bat"] if v is not None]
v_last   = vbat_pts[-1] if vbat_pts else None
v_delta  = vbat_pts[-1] - vbat_pts[-2] if len(vbat_pts) >= 2 else None

# Kelengkapan data 1 jam terakhir (slot dihitung masuk kalau ada minimal 1 nilai PM)
total_slot = n2m
slot_masuk = sum(
    1 for i in range(total_slot)
    if any(d2m["pm"][c][i] is not None for c in d2m["pm"])
)

r2c1, r2c2, r2c3, r2c4 = st.columns(4)
r2c1.metric(
    "🔋 Baterai", fmt(dbat["Percent_bat"], " %", 0),
    help=f"Data terbaru di database: {dbat['updated_at'] or '—'}",
)
r2c2.metric(
    "⚡ Tegangan Terakhir", fmt(v_last, " V", 3),
    delta=f"{v_delta:+.3f} V" if v_delta is not None else None,
)
r2c3.metric(
    "⏳ Uptime", "—" if dupt.get("Uptime") is None else str(dupt["Uptime"]),
    help=f"Update terakhir: {dupt.get('updated_at') or '—'}",
)
r2c4.metric(
    "📶 Data BL Masuk (1 Jam)", f"{slot_masuk}/{total_slot}",
    help=f"Rentang {d2m['start']} s/d {d2m['end']}",
)


# ----------------------- DATA MENTAH: 1 JAM TERAKHIR -----------------------
st.divider()
st.subheader("⏱️ Data 1 Jam Terakhir")
st.caption(
    f"Rentang {d2m['start']} s/d {d2m['end']} · "
    "BiruLangit (BL) tiap 2 menit (30 titik), PurpleAir (PA) tiap 10 menit (6 titik) · "
    "celah di garis = data kosong (NULL)"
)

tab_pm25, tab_th, tab_vbat = st.tabs(["PM2.5 · BL vs PA", "🌡️ Suhu & Kelembapan", "🔋 Tegangan Baterai"])
with tab_pm25:
    st.plotly_chart(chart_pm25(df_2m, df_pa, pa_meta),
                    use_container_width=True, config=CHART_CONFIG, key="chart_raw_pm25")
with tab_th:
    st.plotly_chart(chart_th(df_2m),
                    use_container_width=True, config=CHART_CONFIG, key="chart_raw_th")
with tab_vbat:
    st.plotly_chart(chart_vbat(df_2m),
                    use_container_width=True, config=CHART_CONFIG, key="chart_raw_vbat")


# ----------------------- RATA2 PER JAM: 48 JAM -----------------------
st.divider()
st.subheader("🕐 Rata-rata per Jam — 48 Jam Terakhir")
st.caption(
    "Rata-rata cuma dihitung kalau minimal 75% data tersedia — "
    f"BL: 23 dari 30 data/jam · PA: {dpa.get('min_count_per_jam', 5)} dari 6 data/jam. "
    "Sisanya dikosongin (NULL)."
)

tab_hr_pm25, tab_hr_th = st.tabs(["PM2.5 · BL vs PA", "🌡️ Suhu & Kelembapan"])
with tab_hr_pm25:
    st.plotly_chart(
        chart_pm25(df_hr, df_hr, pa_meta, tickformat="%H:%M<br>%d %b"),
        use_container_width=True, config=CHART_CONFIG, key="chart_hr_pm25",
    )
with tab_hr_th:
    st.plotly_chart(
        chart_th(df_hr, tickformat="%H:%M<br>%d %b"),
        use_container_width=True, config=CHART_CONFIG, key="chart_hr_th",
    )


# ----------------------- RATA2 HARIAN: 14 HARI -----------------------
st.divider()
st.subheader(f"📅 Rata-rata Harian — {dday['tanggal'][0]} s/d {dday['tanggal'][-1]}")
st.caption("Dihitung dari rata-rata per jam tiap harinya, minimal 18 dari 24 jam tersedia")

tab_day_pm25, tab_day_th, tab_day_tabel = st.tabs(
    ["PM2.5 · BL vs PA", "🌡️ Suhu & Kelembapan", "📋 Tabel"]
)
with tab_day_pm25:
    st.plotly_chart(
        chart_pm25(df_day, df_day, pa_meta, x="tanggal", tickformat="%d %b"),
        use_container_width=True, config=CHART_CONFIG, key="chart_day_pm25",
    )
with tab_day_th:
    st.plotly_chart(
        chart_th(df_day, x="tanggal", tickformat="%d %b"),
        use_container_width=True, config=CHART_CONFIG, key="chart_day_th",
    )
with tab_day_tabel:
    tabel = df_day[["tanggal", "PM25v_1", "PM25v_2", "PM25v_3"]].copy()
    tabel.columns = ["Tanggal", "BL S1", "BL S2", "BL S3"]
    for m in pa_meta:
        tabel[f"{m['label']} A"] = df_day[m["col_a"]]
        tabel[f"{m['label']} B"] = df_day[m["col_b"]]
    tabel["Suhu"]       = df_day["Tempoutv"]
    tabel["Kelembapan"] = df_day["Humidoutv"]
    tabel["Tanggal"] = tabel["Tanggal"].dt.strftime("%d %b %Y")
    st.dataframe(tabel.iloc[::-1], use_container_width=True, hide_index=True)

# ---- Ringkasan hari terakhir (kemarin) ----
st.markdown(f"**Rata-rata kemarin ({dday['tanggal'][-1]})**")
kartu = [(f"BL · Sensor {s}", dday["pm"][f"PM25v_{s}"][-1], " µg/m³", 2) for s in (1, 2, 3)]
for m in pa_meta:
    r = m["sensor"].get("rata2_harian") or {}
    kartu.append((f"{m['label']} · Sensor A", kolom(r.get("PM25v_1"), nday)[-1], " µg/m³", 2))
    kartu.append((f"{m['label']} · Sensor B", kolom(r.get("PM25v_2"), nday)[-1], " µg/m³", 2))
kartu.append(("🌡️ Suhu", kolom(thdy.get("Tempoutv"), nday)[-1], " °C", 1))
kartu.append(("💧 Kelembapan", kolom(thdy.get("Humidoutv"), nday)[-1], " %", 1))

per_baris = 5
for awal in range(0, len(kartu), per_baris):
    cols = st.columns(per_baris)
    for col, (judul, nilai, satuan, desimal) in zip(cols, kartu[awal:awal + per_baris]):
        with col:
            with st.container(border=True):
                st.metric(judul, fmt(nilai, satuan, desimal))


# ----------------------- UJI KESERAGAMAN: SD & CV (PM2.5, HARIAN) -----------------------
st.divider()
st.subheader("📐 Uji Keseragaman Sensor BL — SD & CV")
st.caption(
    "Parameter **PM2.5**, basis **rata-rata harian**. "
    f"Syarat keberterimaan: **SD ≤ {SYARAT_SD:.0f} µg/m³** dan **CV ≤ {SYARAT_CV:.0f}%** — "
    "harus lolos dua-duanya. Sensor PurpleAir belum diikutkan."
)

kol_pilih, _ = st.columns([1, 2])
with kol_pilih:
    pilihan_sensor = st.multiselect(
        "Sensor yang dihitung",
        options=list(SENSOR_BL.keys()),
        default=list(SENSOR_BL.keys()),
        format_func=lambda s: f"Sensor {s}",
        key="pilih_sensor_uji",
        help=f"Minimal {MIN_SENSOR_UJI} sensor. Nilai M di rumus ngikut jumlah yang dipilih.",
    )
pilihan_sensor = sorted(pilihan_sensor)

if len(pilihan_sensor) < MIN_SENSOR_UJI:
    st.warning(
        f"Pilih minimal {MIN_SENSOR_UJI} sensor dulu — SD & CV ngukur sebaran antar alat, "
        "jadi gak bisa dihitung dari satu sensor doang.",
        icon="⚠️",
    )
else:
    kol_uji = [SENSOR_BL[s] for s in pilihan_sensor]

    # Rekap seluruh periode: N = jumlah hari yang SEMUA sensor pilihan valid
    rekap = hitung_sd_cv(df_day, kol_uji)

    # Per hari: tiap hari dihitung sendiri, jadi N = 1 tiap barisnya
    baris_harian = []
    jumlah_comply = jumlah_dinilai = 0
    for i in range(len(df_day)):
        h = hitung_sd_cv(df_day.loc[[i]], kol_uji)
        ket = status_uji(h)
        if h["sd"] is not None:
            jumlah_dinilai += 1
            jumlah_comply += (ket == "✅ Comply")

        baris = {"Tanggal": df_day.loc[i, "tanggal"].strftime("%d %b %Y")}
        for s in pilihan_sensor:                      # kolom sensor ngikut pilihan
            baris[f"Sensor {s}"] = fmt_sel(df_day.loc[i, SENSOR_BL[s]])
        baris["Rata-rata (µg/m³)"] = fmt(h["mean"])
        baris["SD (µg/m³)"]        = nilai_syarat(h["sd"], SYARAT_SD)
        baris["CV (%)"]            = nilai_syarat(h["cv"], SYARAT_CV, desimal=1)
        baris["Keterangan"]        = ket
        baris_harian.append(baris)

    u1, u2, u3, u4 = st.columns(4)
    u1.metric(
        "SD · seluruh periode", fmt(rekap["sd"], " µg/m³"),
        help=f"Syarat ≤ {SYARAT_SD:.0f} µg/m³. Dihitung sekaligus dari semua hari valid.",
    )
    u2.metric(
        "CV · seluruh periode", fmt(rekap["cv"], " %", 1),
        help=f"Syarat ≤ {SYARAT_CV:.0f}%",
    )
    u3.metric(
        "N · hari valid", f"{rekap['N']}/{nday}",
        help="Jumlah hari yang SEMUA sensor pilihan sama-sama punya nilai rata-rata valid",
    )
    u4.metric("Status periode", status_uji(rekap), help=f"M = {rekap['M']} sensor")

    catatan = [f"M = **{len(pilihan_sensor)}** sensor ({', '.join(f'S{s}' for s in pilihan_sensor)})"]
    if jumlah_dinilai:
        catatan.append(f"per hari: **{jumlah_comply} dari {jumlah_dinilai}** hari yang bisa dinilai berstatus Comply")
    st.caption(" · ".join(catatan))

    if len(pilihan_sensor) == 2:
        st.caption(
            "ℹ️ Pakai 2 sensor, hasilnya cuma nunjukin selisih dua sensor itu — "
            "gak bisa ketahuan mana yang menyimpang, soalnya gak ada pembanding ketiga."
        )

    st.dataframe(pd.DataFrame(baris_harian).iloc[::-1], use_container_width=True, hide_index=True)

    with st.expander("📖 Rumus & catatan perhitungan"):
        st.latex(
            r"SD = \sqrt{\frac{1}{(N \times M) - 1}\sum_{j=1}^{M}"
            r"\left[\sum_{t=1}^{N}\left(x_{ktj} - \bar{X}_{kt}\right)^{2}\right]}"
            r"\qquad CV = \frac{SD}{\bar{X}_{kt}} \times 100"
        )
        st.markdown(
            f"""
- **M** = jumlah alat ukur identik → ngikut sensor yang dipilih di atas, sekarang **{len(pilihan_sensor)}**.
- **N** = jumlah interval waktu saat **seluruh** sensor pilihan menghasilkan nilai rata-rata valid.
  Hari yang salah satu sensornya NULL dibuang utuh, bukan cuma sensor yang kosong.
- **x₍ktj₎** = rata-rata harian sensor ke-*j* pada hari *t* · **X̄₍kt₎** = rata-rata sensor pilihan pada hari *t*.
- Pembagi ditulis **(N × M) − 1** persis kayak di regulasi (bukan N × (M−1)).
- Syarat keberterimaan: SD ≤ {SYARAT_SD:.0f} µg/m³ **dan** CV ≤ {SYARAT_CV:.0f}%.

**Dua angka yang ditampilkan:**

1. **Per baris tabel** — tiap hari dihitung sendiri, jadi N = 1 dan pembaginya (1×M)−1.
   Kebetulan hasilnya sama persis dengan simpangan baku sampel biasa dari M angka
   (berlaku baik M = 2 maupun 3), jadi gampang dicek manual pakai kalkulator.
2. **Metric "seluruh periode"** — semua hari valid dihitung sekaligus dalam satu rumus,
   jadi N = jumlah hari valid. Ini yang paling dekat sama maksud rumus aslinya kalau
   satu periode pengujian dinilai sebagai satu kesatuan.

**Efek ganti pilihan sensor:** buang satu sensor yang datanya sering bolong, jumlah hari
valid (N) malah bisa naik — soalnya hari yang tadinya kebuang gara-gara sensor itu jadi
kepakai lagi. Jadi wajar kalau N berubah tiap kali pilihannya diganti.

Rata-rata harian sendiri baru dihitung API kalau minimal 18 dari 24 jam tersedia, jadi hari
yang datanya bolong otomatis kosong dan gak ikut dinilai.
"""
        )

        if rekap["mean_alat"]:
            st.markdown("**Rata-rata tiap sensor sepanjang periode** (dari hari yang sama, buat ngecek sensor mana yang menyimpang)")
            ringkas = {f"Sensor {s}": fmt(rekap["mean_alat"][k]) for k, s in enumerate(pilihan_sensor)}
            ringkas["Selisih maks"] = fmt(max(rekap["mean_alat"]) - min(rekap["mean_alat"]))
            ringkas["Hari dipakai"] = rekap["N"]
            st.dataframe(pd.DataFrame([ringkas]), use_container_width=True, hide_index=True)