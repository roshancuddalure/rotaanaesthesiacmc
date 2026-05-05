# Product Understanding

## Product Goal

Build a web application for departmental duty rota operations covering:

- Multiple duty rotas across campuses and duty types.
- Leave management.
- Unit-wise people management.
- Call level and promotion tracking.
- Special postings such as ICU, SICU, Pain, DRP, Neuro ICU.
- Import and analysis of Excel sheets and notepad/text lists.
- Historical analysis, fairness reports, and audit trails.
- Future online deployment for the full team.

The confirmed first version should handle both existing rota import/analysis and creation of new monthly rotas.

The attached analysis guide shows that the domain has many conditional rules. This software therefore needs a strong domain engine, not just CRUD screens.

## Users

Likely user groups:

- Rota admin or coordinator: uploads source files, creates monthly rotas, handles exceptions.
- Unit leads: review unit-wise people, leave, and duty distribution.
- Department leadership: see fairness, workload, weekend duty, promotion, and posting analysis.
- Individual staff: view own duties, leave status, and possibly request leave.

Confirmed MVP users: rota admins only. Other user groups are future expansion candidates.

## Current Reference System

The existing HTML analysis report is a self-contained output dashboard for Jan 2025 to May 2026. It includes:

- Overview statistics.
- Person analysis.
- Weekend duties.
- Duty type analysis.
- CART and Schell sections.
- Shift and PAC counts.
- ICU/Pain/DRP postings.
- Fifth call analysis.
- Promotion timelines.

This is a valuable target for the reporting layer, but the new product should separate:

- raw imports,
- normalized domain data,
- rule processing,
- rota planning,
- reporting output.

## Core Domains

### People

People are not just names. Each person may have:

- canonical name,
- aliases and spelling variants,
- role/call level by month,
- unit by month,
- campus or posting by month,
- seniority and eligibility rules,
- active/inactive status,
- leave and availability constraints.

Name deduplication is a first-class domain problem because incorrect merging can create wrong duty counts and false promotion histories.

### Units

Units include Unit I to Unit VI and department/special areas such as Cardiac Anaesthesia and Neuroanaesthesia. Unitwise files assign call level and unit context by month.

### Duties

The rota contains many duty types:

- Main campus calls.
- RC/Ranipet calls.
- CB/Centenary calls.
- Caesar A and B.
- PAC.
- Shifts.
- CART.
- Schell.
- Floating consultant.
- Fifth call.
- CHAD, RUHSA, Paeds, Neuro department rows.

The same row label can mean different things depending on context, especially PAC block overrides.

### Leave

Leave management needs to integrate with rota generation and validation:

- leave request lifecycle,
- approved/unapproved leave,
- partial day or full day,
- leave type,
- blocked duty dates,
- leave balance if required,
- conflict detection with assigned duties.

Confirmed MVP leave direction: leave balance calculation is not required now. The first version should focus on availability and conflict prevention.

### Analysis

The system must compute:

- total 24-hour duties,
- weekday/weekend split,
- day-of-week distribution,
- monthly distribution,
- duty type breakdown,
- PAC/shift/12-hour separate counts,
- CART and fifth call separate dashboards,
- postings by month,
- call level changes and promotions,
- raw data quality warnings.

Confirmed output direction: final rota/results should export to Excel. Offline HTML analysis export is desirable if feasible.

## Important Product Principle

Every computed number should be explainable down to source file, row label, cell, parsed date, duty type, and rule used. This matters because rota analysis can affect fairness, workload discussions, and departmental trust.
