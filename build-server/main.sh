#!/bin/bash

export GITHUB_REPOSITORY__URL="$GITHUB_REPOSITORY__URL"

git clone "$GITHUB_REPOSITORY__URL" /home/app/output

exec node script.js