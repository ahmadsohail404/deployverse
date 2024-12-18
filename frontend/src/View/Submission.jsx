import styled from "@emotion/styled";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Input from "../components/Input";
import Button from "../components/Button";
import apiService from "../service/apiService";
import { io } from "socket.io-client";

const SubmissionPage = () => {
  const [repoLink, setRepoLink] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSlug, setActiveSlug] = useState("");
  const [url, setUrl] = useState("");
  const [logs, setLogs] = useState([]);

  const logContainerRef = useRef(null);

  const handleSocketIncommingMessage = useCallback((message) => {
    console.log("Received message from socket:", message);

    try {
      if (typeof message === "string") {
        const parsedMessage = JSON.parse(message);
        setLogs((prev) => [...prev, parsedMessage.log || message]);
      } else {
        setLogs((prev) => [...prev, message.log || message]);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
      setLogs((prev) => [...prev, message]);
    }

    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    document.title = "Submit Your Repo - DeployVerse";
  }, []);

  const handleChange = (event) => {
    setRepoLink(event.target.value);
  };

  const handleSubmit = () => {
    console.log(repoLink);
    const githubRepoRegex = /^https:\/\/github\.com\/[^/]+\/[^/]+$/;
    if (!githubRepoRegex.test(repoLink)) {
      setError("Invalid! GitHub repo link.");
    } else {
      setError("");
      setLoading(true);
      apiService("http://localhost:9000/project", "POST", {
        githubURL: repoLink,
        name: slug,
      })
        .then((data) => {
          const { subDomain, id } = data.data.project;
          console.log(subDomain);

          setUrl(`http://${subDomain}.localhost:8000`);
          console.log("Data: ", data);
          return apiService("http://localhost:9000/deploy", "POST", {
            projectId: id,
          });
        })
        .then((deployData) => {
          console.log("Deployment queued:", deployData);
          window.alert("Deployment successfully queued!");
          setActiveSlug(deployData.data.deploymentId);
        })
        .catch((error) => {
          console.log(error);
          window.alert("Error in submitting the repo");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  };

  let socket = useRef(null);

  useEffect(() => {
    if (!socket.current) {
      socket.current = io("http://localhost:9001");
    }
  }, []);

  useEffect(() => {
    if (!activeSlug) return;
    setLogs([]);
    console.log(`Subscribing to channel: logs:${activeSlug}`);
    socket.current.emit("subscribe", `logs:${activeSlug}`);
  }, [activeSlug]);

  useEffect(() => {
    socket.current.on("message", handleSocketIncommingMessage);
    return () => {
      socket.current.off("message", handleSocketIncommingMessage);
    };
  }, [handleSocketIncommingMessage]);

  const handleReset = () => {
    setRepoLink("");
    setSlug("");
    setError("");
    setLoading(false);
    setActiveSlug("");
    setUrl("");
    setLogs([]);
  };
  const Styled = useMemo(
    () => styled.div`
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      .submit-view,
      .log-view {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
        gap: 12px;
        @media (max-width: 768px) {
          padding: 10px;
        }
      }
      .error-text {
        margin: 4px 2px;
        color: red;
        font-size: 12px;
        text-align: center;
      }
      .url-container {
        padding: 4px 8px;
        background: #646cff;
        color: white;
        border-radius: 4px;
      }
      .log-container {
        font-family: "Fira Code", monospace;
        font-size: 0.875rem;
        color: #22c55e;
        margin-top: 1.25rem;
        border: 2px solid #22c55e;
        border-radius: 0.5rem;
        padding: 1rem;
        height: 50vh;
        overflow-y: auto;
        @media (max-width: 768px) {
          max-height: 300px;
        }
        width: 75vw;
        background: #000;
        color: #fff;
        overflow-y: auto;
        padding: 10px;
        border-radius: 8px;
        text-align: left;
        font-size: 16px;
        display: flex;
        flex-direction: column;
        text-align: left;
      }
      .new-submission {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 20px;
      }
      .url {
        text-align: center;
      }
    `,
    []
  );

  return (
    <Styled>
      {!activeSlug ? (
        <div className="submit-view">
          <div className="label">GitHub Repo Link:</div>
          <div>
            <Input
              type="text"
              value={repoLink}
              onChange={handleChange}
              placeholder="https://github.com/username/repo"
            />
            {error && <div className="error-text">{error}</div>}
          </div>
          <Input
            type="text"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
            placeholder="Slug (Optional)"
          />
          <Button
            onClick={loading ? () => { } : handleSubmit}
            text={loading ? "In Progress" : "Deploy"}
          />
        </div>
      ) : (
        <div className="log-view">
          {url && (
            <div className="url">
              Preview URL:{" "}
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="url-container"
              >
                {url}
              </a>
            </div>
          )}
          <div className="title">Showing logs for: {repoLink}</div>
          <div className="log-container" ref={logContainerRef}>
            {logs.map((log, i) => (
              <div
                ref={logs.length - 1 === i ? logContainerRef : undefined}
                key={i}
              >
                <span
                  style={{
                    color: "#22c55e",
                  }}
                >
                  {">"}
                </span>
                {` ${log}`}
              </div>
            ))}
          </div>
        </div>
      )}
      {activeSlug && (
        <div className="new-submission">
          <Button text={"New Submission"} onClick={handleReset} />
        </div>
      )}
    </Styled>
  );
};

export default SubmissionPage;
