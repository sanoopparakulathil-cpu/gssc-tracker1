// Google Sheets Live Sync Configuration
const SPREADSHEET_ID = "1fCFdvQZZ_vB5T1CThI96ZwbIEmOu0QiUVYNCdPWozCQ";

// Function to fetch live data from Google Sheets
async function syncFromGoogleSheets(sheetName = "AMC_Monthly_Schedule") {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
        const response = await fetch(url);
        const text = await response.text();
        
        // Parse Google Visualization JSON response
        const json = JSON.parse(text.substring(47).slice(0, -2));
        const rows = json.table.rows.map(row => 
            row.c.map(cell => (cell ? cell.v : ""))
        );
        
        console.log(`Live data synced for ${sheetName}:`, rows);
        return rows;
    } catch (error) {
        console.error("Auto-sync error, falling back to local storage:", error);
    }
}

// Automatically fetch latest data on page load
window.addEventListener("DOMContentLoaded", () => {
    syncFromGoogleSheets("AMC_Monthly_Schedule");
    syncFromGoogleSheets("GMC_Job_Status");
});