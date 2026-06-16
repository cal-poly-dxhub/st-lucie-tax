# Demo Run Guide

cd st-lucie-tax/

### Create Container
finch compose up -d 


### Start Container
finch start st-lucie-tax-db-1

### Run Server
npx tsx demos/server.ts

### Reset Seed Data
./db/reset.sh

- http://localhost:3000/schedule-demo — scheduling demo
- http://localhost:3000/schedule — check-in schedule
- http://localhost:3000/queue-demo — queue demo
