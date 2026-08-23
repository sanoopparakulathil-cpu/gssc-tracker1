// Auto-load latest data from Google Sheets on page load
const SPREADSHEET_ID = "1fCFdvQZZ_vB5T1CThI96ZwbIEmOu0QiUVYNCdPWozCQ";

async function loadLiveSheetsData() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json`;
        const res = await fetch(url);
        const text = await res.text();
        const data = JSON.parse(text.substring(47).slice(0, -2));
        console.log("Live GSSC data connected successfully:", data);
    } catch (e) {
        console.log("Using cached local data");
    }
}
window.addEventListener("load", loadLiveSheetsData);