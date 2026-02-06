---
layout: default
title: Semantic Integration Items
---

## Overview
This site hosts a 100-item semantic integration dataset for a developmental memory study.

## Downloads
<div class="download-row">
	<a class="download-button" href="semantic_integration_items.csv" download>Download CSV</a>
</div>

## Pages
- [semantic_integration_items.md](semantic_integration_items.md)
- [methods_report.md](methods_report.md)

## Dataset
<div id="dataset-table" class="dataset-loading">Loading dataset...</div>

<style>
	.download-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.download-button {
		display: inline-block;
		padding: 0.6rem 1rem;
		border-radius: 999px;
		background: #1f2937;
		color: #ffffff;
		text-decoration: none;
		font-weight: 600;
	}
	.download-button:hover {
		background: #111827;
	}
	.dataset-loading {
		padding: 0.75rem 0;
	}
	.dataset-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	.dataset-table th,
	.dataset-table td {
		border-bottom: 1px solid #e5e7eb;
		padding: 0.5rem 0.6rem;
		vertical-align: top;
		text-align: left;
	}
	.dataset-table th {
		position: sticky;
		top: 0;
		background: #f9fafb;
		z-index: 1;
	}
	.dataset-table tbody tr:nth-child(even) {
		background: #f9fafb;
	}
	.dataset-scroll {
		max-height: 70vh;
		overflow: auto;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
	}
</style>

<script>
	function parseCsv(text) {
		const rows = [];
		let row = [];
		let value = "";
		let inQuotes = false;

		for (let i = 0; i < text.length; i += 1) {
			const char = text[i];
			const next = text[i + 1];

			if (inQuotes) {
				if (char === '"' && next === '"') {
					value += '"';
					i += 1;
				} else if (char === '"') {
					inQuotes = false;
				} else {
					value += char;
				}
			} else if (char === '"') {
				inQuotes = true;
			} else if (char === ',') {
				row.push(value);
				value = "";
			} else if (char === '\n') {
				row.push(value);
				rows.push(row);
				row = [];
				value = "";
			} else if (char !== '\r') {
				value += char;
			}
		}

		if (value.length || row.length) {
			row.push(value);
			rows.push(row);
		}

		return rows;
	}

	async function loadDataset() {
		const container = document.getElementById("dataset-table");
		if (!container) {
			return;
		}

		try {
			const response = await fetch("semantic_integration_items.csv");
			if (!response.ok) {
				throw new Error("Failed to load dataset.");
			}
			const text = await response.text();
			const rows = parseCsv(text);
			const headers = rows.shift();

			if (!headers || !headers.length) {
				container.textContent = "Dataset is empty.";
				return;
			}

			const table = document.createElement("table");
			table.className = "dataset-table";

			const thead = document.createElement("thead");
			const headRow = document.createElement("tr");
			headers.forEach((header) => {
				const th = document.createElement("th");
				th.textContent = header;
				headRow.appendChild(th);
			});
			thead.appendChild(headRow);
			table.appendChild(thead);

			const tbody = document.createElement("tbody");
			rows.forEach((row) => {
				const tr = document.createElement("tr");
				row.forEach((cell) => {
					const td = document.createElement("td");
					td.textContent = cell;
					tr.appendChild(td);
				});
				tbody.appendChild(tr);
			});
			table.appendChild(tbody);

			const scrollWrap = document.createElement("div");
			scrollWrap.className = "dataset-scroll";
			scrollWrap.appendChild(table);

			container.replaceWith(scrollWrap);
		} catch (error) {
			container.textContent = "Unable to load the dataset right now.";
		}
	}

	loadDataset();
</script>
