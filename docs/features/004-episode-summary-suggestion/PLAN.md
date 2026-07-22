# Episode Summary Suggestion Plan

## Goal

Generate a suggested summary from the transcript and prefill the episode summary field.

## Scope

- use the saved transcript as the only source
- generate a draft summary in Portuguese-BR
- follow the tone and structure of existing summaries
- keep the summary editable in the manage UI

## Prerequisite

- transcript generation feature

## Technical checklist

- read `transcript.txt` from the episode folder
- feed the transcript to the selected local model
- constrain output to Portuguese-BR
- keep the result short and publish-friendly
- store the generated text as a draft suggestion, not as a locked final state
- show background status while the summary is being generated

## Notes

- This feature intentionally does not transcribe audio.
- It depends on the transcript feature already being available.

