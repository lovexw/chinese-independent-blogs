#!/bin/sh
# GIT_ASKPASS：git 需要凭据时由它应答，值始终从环境变量读取，不落盘
case "$1" in
  Username*) echo "x-access-token" ;;
  Password*) echo "${GH_PAT}" ;;
  *) echo "" ;;
esac
