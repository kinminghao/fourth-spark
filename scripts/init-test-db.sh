#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE fourth_spark_test'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fourth_spark_test')\gexec
    GRANT ALL PRIVILEGES ON DATABASE fourth_spark_test TO fourth_spark;
EOSQL
