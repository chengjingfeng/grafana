import React from 'react';
import { InlineField, InlineFieldRow, Select } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { EditorProps } from '../QueryEditor';

export const CSVFileEditor = ({ onChange, query }: EditorProps) => {
  const onChangeFileName = ({ value }: SelectableValue<string>) => {
    onChange({ ...query, csvFileName: value });
  };

  const files = ['population_by_state.csv', 'city_stats.csv'].map((name) => ({ label: name, value: name }));

  return (
    <InlineFieldRow>
      <InlineField label="File" labelWidth={14}>
        <Select
          width={32}
          onChange={onChangeFileName}
          placeholder="Select csv file"
          options={files}
          value={files.find((f) => f.value === query.csvFileName)}
        />
      </InlineField>
    </InlineFieldRow>
  );
};
