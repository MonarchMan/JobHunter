UPDATE `sync_runs`
SET `stats_json` = '{"closed":0,"created":0,"discovered":0,"followupEnqueued":0,"isolated":0,"restored":0,"revised":0,"skippedNonDomestic":0,"skippedOutOfScope":0,"skippedUnknownRegion":0,"staled":0,"unchanged":0}'
WHERE `stats_json` = '{}';
