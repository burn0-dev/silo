import React, { useState } from "react";
import { Box, Text, render, useInput } from "ink";
import { TextInput, Select, Spinner, StatusMessage } from "@inkjs/ui";

import {
  listEnvironments,
  scaffoldEnvironment,
  type Template,
} from "../core/scaffold.js";

type Step =
  | "name"
  | "template"
  | "add-tools"
  | "tools"
  | "creating"
  | "done"
  | "error";

const TEMPLATE_LABELS: Record<Template, string> = {
  blank: "Blank",
  erp: "ERP",
};

const TOOL_OPTIONS = [
  { label: "Calendar", value: "calendar" },
  { label: "Email", value: "email" },
  { label: "CRM", value: "crm" },
  { label: "Browser", value: "browser" },
  { label: "Files", value: "files" },
];

const WORDMARK = [
  "███████╗██╗██╗      ██████╗ ",
  "██╔════╝██║██║     ██╔═══██╗",
  "███████╗██║██║     ██║   ██║",
  "╚════██║██║██║     ██║   ██║",
  "███████║██║███████╗╚██████╔╝",
  "╚══════╝╚═╝╚══════╝ ╚═════╝ ",
];

function suggestName(name: string, taken: string[]) {
  const base = name.replace(/-\d+$/, "");

  let counter = 2;

  while (taken.includes(`${base}-${counter}`.toLowerCase())) {
    counter += 1;
  }

  return `${base}-${counter}`;
}

function Wordmark() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {WORDMARK.map((line) => (
        <Text key={line} color="cyan">
          {line}
        </Text>
      ))}
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Box width={13}>
        <Text dimColor>{label}</Text>
      </Box>

      <Text bold>{value}</Text>
    </Box>
  );
}

function ConfirmPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    const answer = input.toLowerCase();

    if (answer === "y" || key.return) {
      onConfirm();
    }

    if (answer === "n") {
      onCancel();
    }
  });

  return <Text inverse> </Text>;
}

function ToolSelect({
  options,
  onSubmit,
}: {
  options: { label: string; value: string }[];
  onSubmit: (values: string[]) => void;
}) {
  const [focused, setFocused] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);

  useInput((input, key) => {
    if (key.upArrow) {
      setFocused((index) => (index === 0 ? options.length - 1 : index - 1));
    }

    if (key.downArrow) {
      setFocused((index) => (index === options.length - 1 ? 0 : index + 1));
    }

    if (input === " ") {
      const option = options[focused];

      if (option) {
        setSelected((values) =>
          values.includes(option.value)
            ? values.filter((value) => value !== option.value)
            : [...values, option.value],
        );
      }
    }

    if (key.return) {
      onSubmit(selected);
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((option, index) => {
        const isFocused = index === focused;
        const isSelected = selected.includes(option.value);

        return (
          <Box key={option.value}>
            {isFocused ? <Text color="cyan">{"❯ "}</Text> : <Text>{"  "}</Text>}

            {isSelected ? (
              <Text color="cyan">{"◉ "}</Text>
            ) : (
              <Text dimColor>{"◯ "}</Text>
            )}

            <Text bold={isSelected}>{option.label}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function Hints({ items }: { items: [string, string][] }) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {items.map(([key, action]) => `${key} ${action}`).join("   ")}
      </Text>
    </Box>
  );
}

function Question({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Box>
      <Text bold>{title}</Text>

      {children && (
        <>
          <Text dimColor>: </Text>

          {children}
        </>
      )}
    </Box>
  );
}

function InitApp() {
  const [step, setStep] = useState<Step>("name");

  const [name, setName] = useState("");
  const [template, setTemplate] = useState<Template>("blank");

  const [tools, setTools] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState("");

  const done = step === "done";
  const showEnvironment = !done && step !== "name";
  const showTemplate = !done && !["name", "template"].includes(step);

  async function submitName(value: string) {
    const cleaned = value.trim();

    if (!cleaned) {
      return;
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(cleaned)) {
      setError("Use only letters, numbers, hyphens, underscores.");
      return;
    }

    const taken = await listEnvironments();

    if (taken.includes(cleaned.toLowerCase())) {
      setError(`Environment "${cleaned}" already exists.`);
      setSuggestion(suggestName(cleaned, taken));
      return;
    }

    setError("");
    setName(cleaned);
    setStep("template");
  }

  async function finish(selectedTools: string[]) {
    setTools(selectedTools);
    setStep("creating");

    try {
      await scaffoldEnvironment({
        name,
        template,
        tools: selectedTools,
      });

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));

      setStep("error");
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Wordmark />

      {(showEnvironment || showTemplate) && (
        <Box flexDirection="column" marginTop={1}>
          {showEnvironment && <Row label="Environment" value={name} />}

          {showTemplate && (
            <Row label="Template" value={TEMPLATE_LABELS[template]} />
          )}
        </Box>
      )}

      {step === "name" && (
        <Box flexDirection="column" marginTop={1}>
          <Question title="Environment Name">
            <TextInput
              key={suggestion}
              defaultValue={suggestion}
              placeholder="first-environment"
              onSubmit={(value) => {
                void submitName(value);
              }}
            />
          </Question>

          {error && (
            <Box marginTop={1}>
              <Text color="red">{error}</Text>
            </Box>
          )}
        </Box>
      )}

      {step === "template" && (
        <Box flexDirection="column" marginTop={1}>
          <Question title="Choose a template">
            <Select
              options={[
                {
                  label: "Blank",
                  value: "blank",
                },
                {
                  label: "ERP",
                  value: "erp",
                },
              ]}
              onChange={(value) => {
                setTemplate(value as Template);
                setStep("add-tools");
              }}
            />
          </Question>
        </Box>
      )}

      {step === "add-tools" && (
        <Box flexDirection="column" marginTop={1}>
          <Question title="Add more tools? (Y/N)">
            <ConfirmPrompt
              onConfirm={() => {
                setStep("tools");
              }}
              onCancel={() => {
                void finish([]);
              }}
            />
          </Question>
        </Box>
      )}

      {step === "tools" && (
        <Box flexDirection="column" marginTop={1}>
          <Question title="Select additional tools">
            <ToolSelect
              options={TOOL_OPTIONS}
              onSubmit={(values) => {
                void finish(values);
              }}
            />
          </Question>

          <Hints
            items={[
              ["↑↓", "Move"],
              ["Space ␣", "Select"],
              ["Enter ⏎", "Confirm"],
            ]}
          />
        </Box>
      )}

      {step === "creating" && (
        <Box marginTop={1}>
          <Spinner label="Creating environment" />
        </Box>
      )}

      {done && (
        <>
          <Box marginTop={1}>
            <StatusMessage variant="success">Environment created</StatusMessage>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Row label="Environment" value={name} />
            <Row label="Template" value={TEMPLATE_LABELS[template]} />
            <Row
              label="Tools"
              value={tools.length ? tools.join(", ") : "none"}
            />
            <Row label="Location" value={`.silo/environments/${name}`} />
          </Box>
        </>
      )}

      {step === "error" && (
        <Box marginTop={1}>
          <StatusMessage variant="error">{error}</StatusMessage>
        </Box>
      )}
    </Box>
  );
}

export async function init() {
  const instance = render(<InitApp />);

  await instance.waitUntilExit();
}
